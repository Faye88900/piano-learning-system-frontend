"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {addDoc,collection,deleteDoc,doc,onSnapshot,orderBy,query,serverTimestamp,setDoc,updateDoc,where,} from "firebase/firestore";
import { courseCatalog } from "@/lib/courseCatalog";
import { db } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";

const attendanceStatuses = [
  { value: "present", label: "Present", color: "#15803d", background: "#dcfce7" },
  { value: "absent", label: "Absent", color: "#b91c1c", background: "#fee2e2" },
  { value: "excused", label: "Excused", color: "#0369a1", background: "#e0f2fe" },
];

const WEEKDAY_TOKENS = [
  ["sunday", 0],
  ["sun", 0],
  ["monday", 1],
  ["mon", 1],
  ["tuesday", 2],
  ["tue", 2],
  ["wednesday", 3],
  ["wed", 3],
  ["thursday", 4],
  ["thu", 4],
  ["friday", 5],
  ["fri", 5],
  ["saturday", 6],
  ["sat", 6],
];

const INACTIVE_ENROLLMENT_STATUSES = new Set([
  "cancelled",
  "canceled",
  "withdrawn",
  "inactive",
  "refunded",
]);
const RESOLVED_REQUESTS_BATCH = 20;

function parseWeekdayIndexes(dayLabel) {
  const normalized = (dayLabel || "").toLowerCase();
  if (!normalized) return [];
  const indices = new Set();

  if (normalized.includes("weekday")) {
    [1, 2, 3, 4, 5].forEach((value) => indices.add(value));
  }
  if (normalized.includes("weekend")) {
    [0, 6].forEach((value) => indices.add(value));
  }
  for (const [token, index] of WEEKDAY_TOKENS) {
    if (normalized.includes(token)) {
      indices.add(index);
    }
  }

  return Array.from(indices);
}

function normalizeEnrollmentWeekdays(rawDays) {
  if (!Array.isArray(rawDays)) return [];
  const indices = new Set();
  for (const value of rawDays) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) continue;
    if (parsed >= 0 && parsed <= 6) {
      indices.add(parsed);
    } else if (parsed >= 1 && parsed <= 7) {
      indices.add(parsed % 7);
    }
  }
  return Array.from(indices);
}

function getEnrollmentWeekdayIndexes(enrollment) {
  const fromStoredDays = normalizeEnrollmentWeekdays(enrollment?.timeSlotDays);
  if (fromStoredDays.length) return fromStoredDays;
  const dayLabel = String(enrollment?.timeSlotDay || "").trim();
  const slotLabel = String(enrollment?.timeSlotLabel || "").trim();
  return parseWeekdayIndexes(dayLabel || slotLabel);
}

function normalizeDateValue(dateValue) {
  if (dateValue === null || dateValue === undefined) return "";
  const raw = String(dateValue).trim();
  if (!raw) return "";
  const normalized = raw.replace(/[./]/g, "-");
  const matched = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return raw;
  const [, year, month, day] = matched;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeTimeValue(timeValue) {
  if (timeValue === null || timeValue === undefined) return "";
  const raw = String(timeValue).trim();
  if (!raw) return "";
  const matched = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!matched) return "";
  const hour = Number.parseInt(matched[1], 10);
  const minute = Number.parseInt(matched[2], 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return "";
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatDateKey(dateValue) {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getNextSlotOccurrence(dayLabel, startTime) {
  const weekdays = parseWeekdayIndexes(dayLabel);
  if (!weekdays.length) return null;

  const now = new Date();
  const baseDate = new Date();
  baseDate.setHours(0, 0, 0, 0);

  const [hourPart, minutePart] = String(startTime || "00:00")
    .split(":")
    .map((value) => Number.parseInt(value, 10));
  const hour = Number.isFinite(hourPart) ? hourPart : 0;
  const minute = Number.isFinite(minutePart) ? minutePart : 0;

  let bestOccurrence = null;
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + offset);
    if (!weekdays.includes(date.getDay())) continue;

    const dateTime = new Date(date);
    dateTime.setHours(hour, minute, 0, 0);
    if (dateTime.getTime() < now.getTime() - 60 * 1000) continue;

    bestOccurrence = {
      dateKey: formatDateKey(date),
      dateTime,
    };
    break;
  }

  return bestOccurrence;
}

function hasPaidAccess(enrollment) {
  if (!enrollment) return false;
  const paymentStatus = String(enrollment.paymentStatus || "").toLowerCase();
  const status = String(enrollment.status || "").toLowerCase();
  if (INACTIVE_ENROLLMENT_STATUSES.has(paymentStatus) || INACTIVE_ENROLLMENT_STATUSES.has(status)) {
    return false;
  }
  return (
    paymentStatus === "paid" ||
    status === "paid" ||
    Boolean(enrollment.paidAt || enrollment.paymentIntentId || enrollment.paymentReceiptUrl)
  );
}

function formatSessionDateTime(session) {
  if (!session?.date) return "Date TBA";
  const stamp = parseDateTimeMs(session.date, session.startTime || "00:00");
  if (!Number.isFinite(stamp)) {
    return `${session.date}${session.startTime ? ` ${session.startTime}` : ""}`;
  }
  return new Date(stamp).toLocaleString();
}

function getSessionTimestamp(session) {
  if (!session?.date) return null;
  return parseDateTimeMs(session.date, session.startTime || "00:00");
}

function toMillis(value) {
  if (!value) return NaN;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : NaN;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function getEnrollmentActiveFromMs(enrollment) {
  const candidates = [
    enrollment?.slotActivatedAt,
    enrollment?.updatedAt,
    enrollment?.paidAt,
    enrollment?.enrolledAt,
  ];
  let activeFromMs = 0;
  for (const value of candidates) {
    const ms = toMillis(value);
    if (Number.isFinite(ms) && ms > activeFromMs) {
      activeFromMs = ms;
    }
  }
  return activeFromMs;
}

function parseDateTimeMs(dateValue, timeValue = "00:00") {
  const normalizedDate = normalizeDateValue(dateValue);
  if (!normalizedDate) return null;
  const normalizedTime = normalizeTimeValue(timeValue) || "00:00";
  const parsed = new Date(`${normalizedDate}T${normalizedTime}`);
  const stamp = parsed.getTime();
  if (Number.isFinite(stamp)) return stamp;

  const fallback = new Date(`${normalizedDate} ${normalizedTime}`).getTime();
  return Number.isFinite(fallback) ? fallback : null;
}

function getRequestDeadlineMs(request) {
  return (
    parseDateTimeMs(request?.requestedDate, request?.requestedTime) ??
    parseDateTimeMs(request?.sessionDate, request?.sessionStartTime)
  );
}

function getRequestQueueKey(deadlineMs, nowMs = Date.now()) {
  const dayMs = 24 * 60 * 60 * 1000;
  if (deadlineMs === null) return "later";
  if (deadlineMs < nowMs) return "overdue";
  if (deadlineMs < nowMs + 2 * dayMs) return "urgent";
  if (deadlineMs < nowMs + 7 * dayMs) return "thisWeek";
  return "later";
}

export default function TeacherSchedulePage() {

  const router = useRouter();
  const { sessionUser, loading } = useSessionUser();
  const [sessions, setSessions] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [rescheduleRequests, setRescheduleRequests] = useState([]);
  const [resolutionDrafts, setResolutionDrafts] = useState({});
  const [processingRequestId, setProcessingRequestId] = useState(null);
  const [requestFilter, setRequestFilter] = useState("pending");
  const [creatingFixedSessionKey, setCreatingFixedSessionKey] = useState(null);
  const [activeScheduleTab, setActiveScheduleTab] = useState("calendar");
  const [sessionCourseFilter, setSessionCourseFilter] = useState("all");
  const [sessionRangeFilter, setSessionRangeFilter] = useState("all");
  const [sessionSearchKeyword, setSessionSearchKeyword] = useState("");
  const [expandedFixedCourseIds, setExpandedFixedCourseIds] = useState({});
  const [resolvedVisibleCount, setResolvedVisibleCount] = useState(RESOLVED_REQUESTS_BATCH);
  const [expandedUpcomingGroups, setExpandedUpcomingGroups] = useState({
    today: true,
    thisWeek: true,
    later: true,
  });

  useEffect(() => {
    if (loading) return;
    if (!sessionUser) {
      router.push("/login");
      return;
    }
    if (sessionUser.role !== "teacher") {
      router.push("/Dashboard");
    }
  }, [sessionUser, loading, router]);

  useEffect(() => {
    if (!sessionUser?.uid) {
      setSessions([]);
      return;
    }
//找老师id和时间表
    const sessionsQuery = query(
      collection(db, "sessions"),
      where("teacherUid", "==", sessionUser.uid)
    );

    const unsubscribe = onSnapshot(
      sessionsQuery,
      (snapshot) => {
        const nextSessions = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate().toISOString()
              : data.createdAt ?? null;

          return {
            id: docSnapshot.id,
            ...data,
            createdAt,
          };
        });
        setSessions(nextSessions);
      },
      (error) => {
        console.error("Failed to load sessions", error);
        setSessions([]);
      }
    );

    return () => unsubscribe();
  }, [sessionUser]);

  useEffect(() => {
    if (!sessionUser) {
      setEnrollments([]);
      return;
    }

    const enrollmentsQuery = query(
      collection(db, "enrollments"),
      orderBy("enrolledAt", "desc")
    );

    const unsubscribe = onSnapshot(
      enrollmentsQuery,
      (snapshot) => {
        const records = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          const enrolledAt =
            data.enrolledAt && typeof data.enrolledAt.toDate === "function"
              ? data.enrolledAt.toDate().toISOString()
              : data.enrolledAt ?? null;
          return {
            docId: docSnapshot.id,
            ...data,
            enrolledAt,
          };
        });
        setEnrollments(records);
      },
      (error) => {
        console.error("Failed to load enrollments", error);
        setEnrollments([]);
      }
    );

    return () => unsubscribe();
  }, [sessionUser]);

  //当老师选中一堂课时，实时读取并更新该堂课的点名
  useEffect(() => {
    if (!selectedSessionId) {
      setAttendanceRecords([]);
      return;
    }

    const attendanceRef = collection(db, "sessions", selectedSessionId, "attendance");
    const unsubscribe = onSnapshot(
      attendanceRef,
      (snapshot) => {
        const records = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          const markedAt =
            data.markedAt && typeof data.markedAt.toDate === "function"
              ? data.markedAt.toDate().toISOString()
              : data.markedAt ?? null;

          return {
            id: docSnapshot.id,
            sessionId: data.sessionId || selectedSessionId,
            ...data,
            markedAt,
          };
        });
        setAttendanceRecords(records);
      },
      (error) => {
        console.error("Failed to load attendance", error);
        setAttendanceRecords([]);
      }
    );

    return () => unsubscribe();
  }, [selectedSessionId]);

  //先把老师处理改课申请的资料存在前端
   function updateResolutionDraft(requestId, field, value) {
    setResolutionDrafts((prev) => ({
    ...prev,
    [requestId]: {
    ...(prev[requestId] || {}),
      [field]: value,
             },
           }));
         }

  async function handleResolveRequest(request, action) {
    if (!sessionUser) return;
    setProcessingRequestId(request.id);

    const draft = resolutionDrafts[request.id] || {};
    const resolutionNote = (draft.note ?? "").trim();

    try {
      if (action === "approved") {
        const newDate = (draft.newDate || request.requestedDate || "").trim();
        if (!newDate) {
          alert("Please choose a new lesson date before approving.");
          setProcessingRequestId(null);
          return;
        }
        const newTime = (draft.newTime || request.requestedTime || "").trim();

        if (request.sessionId) {
          await updateDoc(doc(db, "sessions", request.sessionId), {
            date: newDate,
            startTime: newTime,
            updatedAt: serverTimestamp(),
          });
        }

        await updateDoc(doc(db, "rescheduleRequests", request.id), {
          status: "approved",
          approvedDate: newDate,
          approvedTime: newTime,
          resolutionNote,
          resolvedAt: serverTimestamp(),
          resolvedBy: sessionUser.email ?? "instructor",
        });
      } else {
        await updateDoc(doc(db, "rescheduleRequests", request.id), {
          status: "rejected",
          resolutionNote: resolutionNote || "Request declined",
          resolvedAt: serverTimestamp(),
          resolvedBy: sessionUser.email ?? "instructor",
        });
      }
      
//把老师刚输入的资料删掉 在前端
      setResolutionDrafts((prev) => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
    } catch (error) {
      console.error("Failed to resolve reschedule request", error);
      alert("Unable to update this request. Please try again.");
    } finally {
      setProcessingRequestId(null);
    }
  }

  async function handleDeleteRequest(requestId) {
    if (!confirm("Remove this request from the list?")) {
      return;
    }
    try {
      await deleteDoc(doc(db, "rescheduleRequests", requestId));
    } catch (error) {
      console.error("Failed to delete reschedule request", error);
      alert("Unable to delete this request right now.");
    }
  }

  useEffect(() => {
    if (!sessionUser?.uid && !sessionUser?.email) {
      setRescheduleRequests([]);
      return;
    }

    const uidRecords = new Map();
    const emailRecords = new Map();

    const normalizeRequestRecord = (docSnapshot) => {
      const data = docSnapshot.data();
      const createdAt =
        data.createdAt && typeof data.createdAt.toDate === "function"
          ? data.createdAt.toDate().toISOString()
          : data.createdAt ?? null;
      const resolvedAt =
        data.resolvedAt && typeof data.resolvedAt.toDate === "function"
          ? data.resolvedAt.toDate().toISOString()
          : data.resolvedAt ?? null;
      return {
        id: docSnapshot.id,
        ...data,
        createdAt,
        resolvedAt,
      };
    };

    const syncMergedRecords = () => {
      const merged = new Map();
      uidRecords.forEach((value, key) => merged.set(key, value));
      emailRecords.forEach((value, key) => merged.set(key, value));
      const records = Array.from(merged.values()).sort((a, b) => {
        const msA = toMillis(a?.createdAt);
        const msB = toMillis(b?.createdAt);
        if (Number.isFinite(msA) && Number.isFinite(msB)) return msB - msA;
        if (Number.isFinite(msB)) return 1;
        if (Number.isFinite(msA)) return -1;
        return 0;
      });
      setRescheduleRequests(records);
    };

    const unsubscribes = [];

    if (sessionUser?.uid) {
      const uidQuery = query(
        collection(db, "rescheduleRequests"),
        where("teacherUid", "==", sessionUser.uid)
      );
      unsubscribes.push(
        onSnapshot(
          uidQuery,
          (snapshot) => {
            uidRecords.clear();
            snapshot.docs.forEach((docSnapshot) => {
              uidRecords.set(docSnapshot.id, normalizeRequestRecord(docSnapshot));
            });
            syncMergedRecords();
          },
          (error) => {
            console.error("Failed to load reschedule requests (uid)", error);
            uidRecords.clear();
            syncMergedRecords();
          }
        )
      );
    }

    if (sessionUser?.email) {
      const emailQuery = query(
        collection(db, "rescheduleRequests"),
        where("teacherEmail", "==", sessionUser.email)
      );
      unsubscribes.push(
        onSnapshot(
          emailQuery,
          (snapshot) => {
            emailRecords.clear();
            snapshot.docs.forEach((docSnapshot) => {
              emailRecords.set(docSnapshot.id, normalizeRequestRecord(docSnapshot));
            });
            syncMergedRecords();
          },
          (error) => {
            console.error("Failed to load reschedule requests (email)", error);
            emailRecords.clear();
            syncMergedRecords();
          }
        )
      );
    }

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [sessionUser?.uid, sessionUser?.email]);

//sessions 按日期分成
  const sessionsByDate = useMemo(() => {
    const upcoming = [];
    const past = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStamp = today.getTime();

    for (const session of sessions) {
      if (session.archived) continue;
      const sessionStamp = getSessionTimestamp(session);
      if (!Number.isFinite(sessionStamp)) {
        past.push(session);
      } else if (sessionStamp >= todayStamp) {
        upcoming.push(session);
      } else {
        past.push(session);
      }
    }

    upcoming.sort((a, b) => {
      const aStamp = getSessionTimestamp(a);
      const bStamp = getSessionTimestamp(b);
      const aValue = Number.isFinite(aStamp) ? aStamp : Number.MAX_SAFE_INTEGER;
      const bValue = Number.isFinite(bStamp) ? bStamp : Number.MAX_SAFE_INTEGER;
      return aValue - bValue;
    });
    past.sort((a, b) => {
      const aStamp = getSessionTimestamp(a);
      const bStamp = getSessionTimestamp(b);
      const aValue = Number.isFinite(aStamp) ? aStamp : Number.MIN_SAFE_INTEGER;
      const bValue = Number.isFinite(bStamp) ? bStamp : Number.MIN_SAFE_INTEGER;
      return bValue - aValue;
    });
    return { upcoming, past };
  }, [sessions]);

  const sessionCourseOptions = useMemo(() => {
    const grouped = new Map();
    for (const session of sessions || []) {
      if (session?.archived) continue;
      if (!session?.courseId) continue;
      if (grouped.has(session.courseId)) continue;
      const catalogCourse = courseCatalog.find((course) => course.id === session.courseId);
      grouped.set(session.courseId, catalogCourse?.title || session.courseTitle || session.courseId);
    }

    return Array.from(grouped.entries())
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }, [sessions]);

  const filteredUpcomingSessions = useMemo(() => {
    const keyword = sessionSearchKeyword.trim().toLowerCase();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayStamp = startOfToday.getTime();
    const inSevenDays = todayStamp + 7 * 24 * 60 * 60 * 1000;

    return sessionsByDate.upcoming.filter((session) => {
      if (sessionCourseFilter !== "all" && (session.courseId || "") !== sessionCourseFilter) return false;

      const stamp = getSessionTimestamp(session);
      if (sessionRangeFilter === "today") {
        if (stamp === null || stamp < todayStamp || stamp >= todayStamp + 24 * 60 * 60 * 1000) return false;
      } else if (sessionRangeFilter === "next7") {
        if (stamp === null || stamp < todayStamp || stamp >= inSevenDays) return false;
      }

      if (!keyword) return true;
      const searchable = [
        session.title,
        session.courseTitle,
        session.location,
        session.date,
        session.startTime,
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(keyword);
    });
  }, [sessionsByDate.upcoming, sessionCourseFilter, sessionRangeFilter, sessionSearchKeyword]);

  const filteredPastSessions = useMemo(() => {
    const keyword = sessionSearchKeyword.trim().toLowerCase();
    return sessionsByDate.past.filter((session) => {
      if (sessionCourseFilter !== "all" && (session.courseId || "") !== sessionCourseFilter) return false;
      if (!keyword) return true;
      const searchable = [
        session.title,
        session.courseTitle,
        session.location,
        session.date,
        session.startTime,
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(keyword);
    });
  }, [sessionsByDate.past, sessionCourseFilter, sessionSearchKeyword]);

  const upcomingSessionGroups = useMemo(() => {
    const oneDay = 24 * 60 * 60 * 1000;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayStart = startOfToday.getTime();
    const tomorrowStart = todayStart + oneDay;
    const nextWeekStart = todayStart + 7 * oneDay;

    const grouped = {
      today: [],
      thisWeek: [],
      later: [],
    };

    for (const session of filteredUpcomingSessions) {
      const stamp = getSessionTimestamp(session);
      if (stamp === null) {
        grouped.later.push(session);
        continue;
      }
      if (stamp < tomorrowStart) {
        grouped.today.push(session);
      } else if (stamp < nextWeekStart) {
        grouped.thisWeek.push(session);
      } else {
        grouped.later.push(session);
      }
    }

    return [
      { key: "today", label: "Today", sessions: grouped.today },
      { key: "thisWeek", label: "This week", sessions: grouped.thisWeek },
      { key: "later", label: "Later", sessions: grouped.later },
    ];
  }, [filteredUpcomingSessions]);

  const attendanceMap = useMemo(() => {
    const map = new Map();
    for (const record of attendanceRecords) {
      const identifier = record.studentUid || record.studentEmail || "student";
      const key = `${record.sessionId}::${identifier}`;
      map.set(key, record);
    }
    return map;
  }, [attendanceRecords]);

  const pendingRequests = useMemo(
    () => rescheduleRequests.filter((request) => request.status === "pending"),
    [rescheduleRequests]
  );

  const resolvedRequests = useMemo(
    () => rescheduleRequests.filter((request) => request.status !== "pending"),
    [rescheduleRequests]
  );

  const filteredRequests = useMemo(() => {
    if (requestFilter === "resolved") return resolvedRequests;
    if (requestFilter === "all") return rescheduleRequests;
    return pendingRequests;
  }, [requestFilter, pendingRequests, resolvedRequests, rescheduleRequests]);

  const requestQueueMeta = useMemo(
    () => ({
      overdue: {
        key: "overdue",
        label: "Overdue",
        badgeColor: "#b91c1c",
        badgeBg: "#fee2e2",
        cardBg: "#fff1f2",
        cardBorder: "rgba(244,63,94,0.35)",
      },
      urgent: {
        key: "urgent",
        label: "Urgent",
        badgeColor: "#c2410c",
        badgeBg: "#ffedd5",
        cardBg: "#fff7ed",
        cardBorder: "rgba(249,115,22,0.35)",
      },
      thisWeek: {
        key: "thisWeek",
        label: "This week",
        badgeColor: "#1d4ed8",
        badgeBg: "#dbeafe",
        cardBg: "#eff6ff",
        cardBorder: "rgba(59,130,246,0.35)",
      },
      later: {
        key: "later",
        label: "Later",
        badgeColor: "#334155",
        badgeBg: "#e2e8f0",
        cardBg: "#f8fafc",
        cardBorder: "rgba(148,163,184,0.35)",
      },
    }),
    []
  );

  const pendingQueueCounts = useMemo(() => {
    const nowMs = Date.now();
    const counts = { overdue: 0, urgent: 0, thisWeek: 0, later: 0 };
    for (const request of pendingRequests) {
      const key = getRequestQueueKey(getRequestDeadlineMs(request), nowMs);
      counts[key] += 1;
    }
    return counts;
  }, [pendingRequests]);

  const filteredPendingRequestGroups = useMemo(() => {
    const nowMs = Date.now();
    const grouped = { overdue: [], urgent: [], thisWeek: [], later: [] };
    for (const request of filteredRequests) {
      if (request.status !== "pending") continue;
      const deadlineMs = getRequestDeadlineMs(request);
      const queueKey = getRequestQueueKey(deadlineMs, nowMs);
      grouped[queueKey].push({ ...request, deadlineMs, queueKey });
    }

    return Object.keys(grouped).map((key) => {
      const items = grouped[key].sort((a, b) => {
        const aDeadline = a.deadlineMs ?? Number.MAX_SAFE_INTEGER;
        const bDeadline = b.deadlineMs ?? Number.MAX_SAFE_INTEGER;
        if (aDeadline !== bDeadline) return aDeadline - bDeadline;
        const aCreated = Date.parse(a.createdAt || "") || 0;
        const bCreated = Date.parse(b.createdAt || "") || 0;
        return aCreated - bCreated;
      });
      return {
        ...requestQueueMeta[key],
        items,
      };
    });
  }, [filteredRequests, requestQueueMeta]);

  const filteredResolvedRequests = useMemo(
    () => filteredRequests.filter((request) => request.status !== "pending"),
    [filteredRequests]
  );
  const visibleResolvedRequests = useMemo(
    () => filteredResolvedRequests.slice(0, resolvedVisibleCount),
    [filteredResolvedRequests, resolvedVisibleCount]
  );
  const hasMoreResolvedRequests = filteredResolvedRequests.length > resolvedVisibleCount;

  useEffect(() => {
    if (activeScheduleTab !== "requests") return;
    setResolvedVisibleCount(RESOLVED_REQUESTS_BATCH);
  }, [requestFilter, activeScheduleTab]);

  const paidEnrollments = useMemo(
    () => (enrollments || []).filter((enrollment) => hasPaidAccess(enrollment)),
    [enrollments]
  );

  const fixedWeeklySlots = useMemo(() => {
    const grouped = new Map();

    for (const enrollment of paidEnrollments) {
      const courseId = enrollment.courseId || enrollment.id || "";
      const course = courseCatalog.find((item) => item.id === courseId);
      if (!courseId || !course) continue;

      const dayLabel = (enrollment.timeSlotDay || "").trim();
      const startTime = (enrollment.timeSlotStartTime || "").trim();
      const endTime = (enrollment.timeSlotEndTime || "").trim();
      const slotLabel =
        dayLabel && startTime && endTime
          ? `${dayLabel} ${startTime} - ${endTime}`
          : (enrollment.timeSlotLabel || "").trim();
      if (!slotLabel) continue;

      const key = `${courseId}::${dayLabel}::${startTime}::${endTime}::${slotLabel}`;
      const studentId = enrollment.studentUid || enrollment.studentEmail || enrollment.docId || "";
      if (!studentId) continue;

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          courseId,
          courseTitle: course.title || enrollment.courseTitle || "Course",
          courseLevel: course.level || "",
          dayLabel,
          startTime,
          endTime,
          slotLabel,
          meetingLink: (enrollment.meetingLink || "").trim(),
          students: [],
          studentSet: new Set(),
          activeFromMs: 0,
        });
      }

      const slot = grouped.get(key);
      if (!slot.studentSet.has(studentId)) {
        slot.studentSet.add(studentId);
        slot.students.push({
          studentUid: enrollment.studentUid || "",
          studentEmail: enrollment.studentEmail || "",
          studentName: enrollment.studentName || enrollment.studentEmail || "Student",
        });
      }
      if (!slot.meetingLink && enrollment.meetingLink) {
        slot.meetingLink = enrollment.meetingLink.trim();
      }
      const activeFromMs = getEnrollmentActiveFromMs(enrollment);
      if (activeFromMs > slot.activeFromMs) {
        slot.activeFromMs = activeFromMs;
      }
    }

    return Array.from(grouped.values())
      .map((slot) => ({
        ...slot,
        studentCount: slot.students.length,
      }))
      .sort((a, b) => {
        const byCourse = (a.courseTitle || "").localeCompare(b.courseTitle || "");
        if (byCourse !== 0) return byCourse;
        return (a.slotLabel || "").localeCompare(b.slotLabel || "");
      });
  }, [paidEnrollments]);

  const summaryCounts = useMemo(() => {
    const upcomingCount = sessionsByDate.upcoming.length;
    const thisWeekCount = sessionsByDate.upcoming.filter((s) => {
      const sessionStamp = getSessionTimestamp(s);
      if (!Number.isFinite(sessionStamp)) return false;
      const diffDays = (sessionStamp - Date.now()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 7;
    }).length;
    const requestCounts = {
      pending: pendingRequests.length,
      resolved: resolvedRequests.length,
    };
    return { upcomingCount, thisWeekCount, requestCounts };
  }, [sessionsByDate.upcoming, pendingRequests, resolvedRequests]);

  const nearestUpcomingSessionByCourse = useMemo(() => {
    const map = new Map();
    const nowTime = Date.now();
    const cutoff = nowTime - 60 * 60 * 1000;

    for (const session of sessions || []) {
      if (session?.archived) continue;
      if (!session?.courseId || !session?.date) continue;
      const stamp = getSessionTimestamp(session);
      if (!Number.isFinite(stamp) || stamp < cutoff) continue;

      const existing = map.get(session.courseId);
      if (!existing || stamp < existing.stamp) {
        map.set(session.courseId, { stamp, session });
      }
    }

    const cleaned = new Map();
    for (const [courseId, payload] of map.entries()) {
      cleaned.set(courseId, payload.session);
    }
    return cleaned;
  }, [sessions]);

  const fixedWeeklyCourseGroups = useMemo(() => {
    const groups = new Map();
    const nowCutoff = Date.now() - 60 * 60 * 1000;

    for (const slot of fixedWeeklySlots) {
      const slotWeekdays = parseWeekdayIndexes(slot.dayLabel);
      const slotStartTime = String(slot.startTime || "").trim();
      const slotActiveFromMs = Number.isFinite(slot.activeFromMs) ? slot.activeFromMs : 0;
      const eligibleSessions = (sessions || []).filter((session) => {
        if (session.archived) return false;
        if ((session.courseId || "") !== slot.courseId) return false;
        const sessionStamp = getSessionTimestamp(session);
        if (!Number.isFinite(sessionStamp)) return false;
        if (slotActiveFromMs && sessionStamp < slotActiveFromMs - 60 * 1000) return false;
        return true;
      });
      const nextOccurrence = getNextSlotOccurrence(slot.dayLabel, slot.startTime);
      const scheduledSession = eligibleSessions.reduce((best, session) => {
        const sessionStamp = getSessionTimestamp(session);
        if (!Number.isFinite(sessionStamp) || sessionStamp < nowCutoff) return best;
        const sessionStart = String(session.startTime || "").trim();
        if (slotStartTime && sessionStart && sessionStart !== slotStartTime) return best;
        if (slotWeekdays.length) {
          const sessionDay = Number.isFinite(sessionStamp) ? new Date(sessionStamp).getDay() : null;
          if (!slotWeekdays.includes(sessionDay)) return best;
        }
        if (!best) return session;
        const bestStamp = getSessionTimestamp(best);
        if (!Number.isFinite(bestStamp) || sessionStamp < bestStamp) return session;
        return best;
      }, null);
      const matchingSession = nextOccurrence
        ? eligibleSessions.find((session) => {
            if ((session.date || "") !== nextOccurrence.dateKey) return false;
            if (!slot.startTime) return true;
            return (session.startTime || "") === slot.startTime;
          })
        : null;
      const usingScheduledSession =
        !!scheduledSession && (!matchingSession || scheduledSession.id !== matchingSession.id);
      const scheduledStamp = getSessionTimestamp(scheduledSession);
      const nextOccurrenceStamp = nextOccurrence?.dateTime?.getTime();
      const nextStamp =
        (Number.isFinite(scheduledStamp) ? scheduledStamp : NaN) ||
        (Number.isFinite(nextOccurrenceStamp) ? nextOccurrenceStamp : NaN) ||
        Number.MAX_SAFE_INTEGER;
      const nextLabel = scheduledSession
        ? formatSessionDateTime(scheduledSession)
        : nextOccurrence
        ? nextOccurrence.dateTime.toLocaleString()
        : "Date TBD";

      const slotItem = {
        ...slot,
        nextOccurrence,
        scheduledSession,
        matchingSession,
        usingScheduledSession,
        nextStamp,
        nextLabel,
      };

      if (!groups.has(slot.courseId)) {
        groups.set(slot.courseId, {
          courseId: slot.courseId,
          courseTitle: slot.courseTitle,
          slots: [],
          studentMap: new Map(),
        });
      }

      const group = groups.get(slot.courseId);
      group.slots.push(slotItem);
      for (const student of slot.students || []) {
        const key = student.studentUid || student.studentEmail || student.studentName || "";
        if (!key) continue;
        if (!group.studentMap.has(key)) group.studentMap.set(key, student);
      }
    }

    return Array.from(groups.values())
      .map((group) => {
        const slots = [...group.slots].sort((a, b) => {
          if (a.nextStamp !== b.nextStamp) return a.nextStamp - b.nextStamp;
          return (a.slotLabel || "").localeCompare(b.slotLabel || "");
        });
        const earliestStamp = slots[0]?.nextStamp ?? Number.MAX_SAFE_INTEGER;
        return {
          courseId: group.courseId,
          courseTitle: group.courseTitle,
          slots,
          studentCount: group.studentMap.size,
          students: Array.from(group.studentMap.values()).sort((a, b) =>
            (a.studentName || "").localeCompare(b.studentName || "")
          ),
          earliestStamp,
        };
      })
      .sort((a, b) => {
        if (a.earliestStamp !== b.earliestStamp) return a.earliestStamp - b.earliestStamp;
        return (a.courseTitle || "").localeCompare(b.courseTitle || "");
      });
  }, [fixedWeeklySlots, sessions]);

  useEffect(() => {
    if (!fixedWeeklyCourseGroups.length) {
      setExpandedFixedCourseIds({});
      return;
    }

    setExpandedFixedCourseIds((previous) => {
      const next = {};
      fixedWeeklyCourseGroups.forEach((group, index) => {
        next[group.courseId] = Object.prototype.hasOwnProperty.call(previous, group.courseId)
          ? previous[group.courseId]
          : index === 0;
      });
      return next;
    });
  }, [fixedWeeklyCourseGroups]);

//当前选中的课程
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  const studentsForSelectedSession = useMemo(() => {
    if (!selectedSession?.courseId) return [];

    const selectedSessionDate = normalizeDateValue(selectedSession.date);
    const selectedSessionStartTime =
      normalizeTimeValue(selectedSession.startTime) || String(selectedSession.startTime || "").trim();
    const selectedSessionStamp = getSessionTimestamp(selectedSession);
    const selectedSessionDay = Number.isFinite(selectedSessionStamp)
      ? new Date(selectedSessionStamp).getDay()
      : null;

    const approvedStudentKeys = new Set();
    for (const request of rescheduleRequests || []) {
      const status = String(request?.status || "").toLowerCase();
      if (status !== "approved") continue;
      if ((request.courseId || "") !== selectedSession.courseId) continue;

      const requestDate = normalizeDateValue(request.approvedDate || request.requestedDate);
      const requestTime =
        normalizeTimeValue(request.approvedTime || request.requestedTime) ||
        String(request.approvedTime || request.requestedTime || "").trim();
      const hasSessionBinding = Boolean(request.sessionId);
      const sameSessionId = hasSessionBinding && request.sessionId === selectedSession.id;
      const sameDate = Boolean(requestDate && requestDate === selectedSessionDate);
      const sameTimeOrFlexible =
        !requestTime || !selectedSessionStartTime || requestTime === selectedSessionStartTime;
      const requestMatchesSession =
        sameSessionId ||
        (sameDate && (sameTimeOrFlexible || !hasSessionBinding));

      if (!requestMatchesSession) continue;
      const requestStudentUid = String(request.studentUid || "").trim();
      const requestStudentEmail = String(request.studentEmail || "").trim();
      if (requestStudentUid) approvedStudentKeys.add(requestStudentUid);
      if (requestStudentEmail) approvedStudentKeys.add(requestStudentEmail);
    }

    const latestEnrollmentByStudent = new Map();
    for (const enrollment of paidEnrollments) {
      if ((enrollment.courseId || "") !== selectedSession.courseId) continue;
      const identifier = enrollment.studentUid || enrollment.studentEmail || enrollment.docId || "";
      if (!identifier || latestEnrollmentByStudent.has(identifier)) continue;
      latestEnrollmentByStudent.set(identifier, enrollment);
    }

    const grouped = new Map();
    for (const [studentKey, enrollment] of latestEnrollmentByStudent.entries()) {
      if (!studentKey || grouped.has(studentKey)) continue;

      const enrollmentStudentKeys = [
        String(enrollment.studentUid || "").trim(),
        String(enrollment.studentEmail || "").trim(),
      ].filter(Boolean);
      const isApprovedRescheduleStudent = enrollmentStudentKeys.some((key) =>
        approvedStudentKeys.has(key)
      );

      if (!isApprovedRescheduleStudent) {
        const enrollmentActiveFromMs = getEnrollmentActiveFromMs(enrollment);
        if (
          Number.isFinite(selectedSessionStamp) &&
          enrollmentActiveFromMs &&
          selectedSessionStamp < enrollmentActiveFromMs - 60 * 1000
        ) {
          continue;
        }

        const enrollmentStartTime =
          normalizeTimeValue(enrollment.timeSlotStartTime) ||
          normalizeTimeValue((String(enrollment.timeSlotLabel || "").match(/(\d{1,2}:\d{2})/) || [])[1]) ||
          String(enrollment.timeSlotStartTime || "").trim();
        if (enrollmentStartTime && selectedSessionStartTime && enrollmentStartTime !== selectedSessionStartTime) {
          continue;
        }

        const enrollmentDays = getEnrollmentWeekdayIndexes(enrollment);
        if (enrollmentDays.length && Number.isInteger(selectedSessionDay) && !enrollmentDays.includes(selectedSessionDay)) {
          continue;
        }
      }

      grouped.set(studentKey, {
        studentEmail: enrollment.studentEmail || "",
        studentName: enrollment.studentName || enrollment.studentEmail || "Student",
        studentUid: enrollment.studentUid || "",
      });
    }

    return Array.from(grouped.values())
      .sort((a, b) => (a.studentName || "").localeCompare(b.studentName || ""));
  }, [paidEnrollments, rescheduleRequests, selectedSession]);

  async function handleDeleteSession(sessionId) {
    if (!confirm("Remove this session from schedule?")) {
      return;
    }

    try {
      const sessionRef = doc(db, "sessions", sessionId);
      await updateDoc(sessionRef, {
        archived: true,
        skipFixedRegeneration: false,
        archivedAt: serverTimestamp(),
        archivedBy: sessionUser?.email || "instructor",
      });
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
      }
    } catch (error) {
      console.error("Failed to delete session", error);
      alert("Unable to delete this session right now.");
    }
  }

  function openAttendanceSession(sessionId) {
    if (!sessionId) return;
    setSelectedSessionId(sessionId);
    setActiveScheduleTab("attendance");
    window.setTimeout(() => {
      const panel = document.getElementById("attendance-panel");
      if (!panel) return;
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }

  function toggleFixedCourseGroup(courseId) {
    setExpandedFixedCourseIds((previous) => ({
      ...previous,
      [courseId]: !previous[courseId],
    }));
  }

  function expandAllFixedCourseGroups() {
    const next = {};
    fixedWeeklyCourseGroups.forEach((group) => {
      next[group.courseId] = true;
    });
    setExpandedFixedCourseIds(next);
  }

  function collapseAllFixedCourseGroups() {
    const next = {};
    fixedWeeklyCourseGroups.forEach((group) => {
      next[group.courseId] = false;
    });
    setExpandedFixedCourseIds(next);
  }

  function toggleUpcomingGroup(groupKey) {
    setExpandedUpcomingGroups((previous) => ({
      ...previous,
      [groupKey]: !previous[groupKey],
    }));
  }

  function renderRequestCard(request, options = {}) {
    const tone = options.tone || null;
    const draft = resolutionDrafts[request.id] || {};
    const isProcessing = processingRequestId === request.id;
    const isPending = request.status === "pending";
    const deadlineMs = getRequestDeadlineMs(request);
    const statusColors = {
      pending: { color: "#a855f7", background: "#f3e8ff" },
      approved: { color: "#15803d", background: "#dcfce7" },
      rejected: { color: "#b91c1c", background: "#fee2e2" },
    };
    const statusStyle = statusColors[request.status] || statusColors.pending;

    return (
      <article
        key={request.id}
        style={{
          borderRadius: "14px",
          border: `1px solid ${tone?.cardBorder || "rgba(226,232,240,0.9)"}`,
          padding: "16px",
          backgroundColor: tone?.cardBg || "#f8fafc",
          display: "grid",
          gap: "10px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
            alignItems: "center",
          }}
        >
          <div>
            <p style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
              {request.studentName} · {request.studentEmail}
            </p>
            <p style={{ fontSize: "12px", color: "#334155", marginTop: "4px" }}>
              Course: {request.courseTitle || request.courseId}
            </p>
            <p style={{ fontSize: "12px", color: "#64748b" }}>
              Original session: {request.sessionDate || request.sessionStartTime
                ? `${request.sessionDate || ""} ${request.sessionStartTime || ""}`.trim()
                : "Not assigned yet (first-lesson request)"}
            </p>
            {request.requestedDate && (
              <p style={{ fontSize: "12px", color: "#64748b" }}>
                Preferred date: {request.requestedDate} {request.requestedTime}
              </p>
            )}
            {deadlineMs && (
              <p style={{ fontSize: "12px", color: "#0f172a", fontWeight: 600 }}>
                Deadline reference: {new Date(deadlineMs).toLocaleString()}
              </p>
            )}
            {request.message && (
              <p style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
                Student note: {request.message}
              </p>
            )}
          </div>
          <div style={{ display: "grid", gap: "6px", justifyItems: "end" }}>
            {!!tone && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "4px 10px",
                  borderRadius: "999px",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: tone.badgeColor,
                  backgroundColor: tone.badgeBg,
                  whiteSpace: "nowrap",
                }}
              >
                {tone.label}
              </span>
            )}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 12px",
                borderRadius: "999px",
                fontSize: "12px",
                fontWeight: 600,
                color: statusStyle.color,
                backgroundColor: statusStyle.background,
                whiteSpace: "nowrap",
              }}
            >
              {request.status}
            </span>
          </div>
        </div>

        {isPending ? (
          <form style={{ display: "grid", gap: "10px" }}>
            <div
              style={{
                display: "grid",
                gap: "10px",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              }}
            >
              <label style={{ display: "grid", gap: "6px", fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>
                New date
                <input
                  type="date"
                  value={draft.newDate ?? request.requestedDate ?? ""}
                  onChange={(event) => updateResolutionDraft(request.id, "newDate", event.target.value)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5f5",
                    backgroundColor: "white",
                    color: "#0f172a",
                    colorScheme: "light",
                    fontSize: "13px",
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: "6px", fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>
                New time
                <input
                  type="time"
                  value={draft.newTime ?? request.requestedTime ?? ""}
                  onChange={(event) => updateResolutionDraft(request.id, "newTime", event.target.value)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5f5",
                    backgroundColor: "white",
                    color: "#0f172a",
                    colorScheme: "light",
                    fontSize: "13px",
                  }}
                />
              </label>
            </div>

            <label style={{ display: "grid", gap: "6px", fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>
              Instructor note
              <textarea
                value={draft.note ?? ""}
                onChange={(event) => updateResolutionDraft(request.id, "note", event.target.value)}
                rows={3}
                placeholder="Optional note for the student."
                style={{
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: "1px solid #cbd5f5",
                  backgroundColor: "white",
                  color: "#0f172a",
                  colorScheme: "light",
                  fontSize: "13px",
                  resize: "vertical",
                }}
              />
            </label>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => handleResolveRequest(request, "approved")}
                disabled={isProcessing}
                style={{
                  padding: "8px 16px",
                  borderRadius: "10px",
                  border: "none",
                  backgroundColor: isProcessing ? "#94a3b8" : "#22c55e",
                  color: "white",
                  fontWeight: 600,
                  cursor: isProcessing ? "not-allowed" : "pointer",
                }}
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => handleResolveRequest(request, "rejected")}
                disabled={isProcessing}
                style={{
                  padding: "8px 16px",
                  borderRadius: "10px",
                  border: "1px solid rgba(239,68,68,0.4)",
                  backgroundColor: "white",
                  color: "#b91c1c",
                  fontWeight: 600,
                  cursor: isProcessing ? "not-allowed" : "pointer",
                }}
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => handleDeleteRequest(request.id)}
                disabled={isProcessing}
                style={{
                  padding: "8px 16px",
                  borderRadius: "10px",
                  border: "1px solid rgba(148,163,184,0.45)",
                  backgroundColor: "white",
                  color: "#334155",
                  fontWeight: 600,
                  cursor: isProcessing ? "not-allowed" : "pointer",
                }}
              >
                Delete
              </button>
            </div>
          </form>
        ) : (
          <p style={{ fontSize: "12px", color: "#475569" }}>
            Resolved on {request.resolvedAt ? new Date(request.resolvedAt).toLocaleString() : "N/A"}
            {request.resolutionNote ? ` · Note: ${request.resolutionNote}` : ""}
          </p>
        )}

        {!isPending && (
          <button
            type="button"
            onClick={() => handleDeleteRequest(request.id)}
            style={{
              padding: "6px 12px",
              borderRadius: "999px",
              border: "1px solid rgba(239,68,68,0.4)",
              backgroundColor: "white",
              color: "#b91c1c",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              justifySelf: "start",
            }}
          >
            Remove from list
          </button>
        )}
      </article>
    );
  }

  async function handleOpenFixedAttendance(slot) {
    if (!sessionUser?.uid || !slot?.courseId) return;

    setCreatingFixedSessionKey(slot.key);
    try {
      const scheduledSession = slot?.scheduledSession || null;
      if (scheduledSession) {
        openAttendanceSession(scheduledSession.id);
        return;
      }

      const occurrence = getNextSlotOccurrence(slot.dayLabel, slot.startTime);
      if (!occurrence) {
        alert("Unable to determine the next lesson date. Please check the weekly slot day format.");
        return;
      }

      const existingSession = sessions.find((session) => {
        if (session.archived) return false;
        if ((session.courseId || "") !== slot.courseId) return false;
        if ((session.date || "") !== occurrence.dateKey) return false;
        if (!slot.startTime) return true;
        return (session.startTime || "") === slot.startTime;
      });

      if (existingSession) {
        openAttendanceSession(existingSession.id);
        return;
      }

      const course = courseCatalog.find((item) => item.id === slot.courseId);
      const createdSession = await addDoc(collection(db, "sessions"), {
        courseId: slot.courseId,
        courseTitle: slot.courseTitle || course?.title || "",
        courseLevel: slot.courseLevel || course?.level || "",
        title: `${slot.courseTitle || course?.title || "Lesson"} Weekly Session`,
        date: occurrence.dateKey,
        startTime: slot.startTime || "",
        endTime: slot.endTime || "",
        location: slot.meetingLink || "",
        notes: "Auto-created from fixed weekly slot for attendance tracking.",
        source: "fixed_weekly_slot",
        slotKey: slot.key,
        teacherUid: sessionUser.uid,
        teacherEmail: sessionUser.email || "",
        createdAt: serverTimestamp(),
      });

      openAttendanceSession(createdSession.id);
    } catch (error) {
      console.error("Failed to open fixed attendance session", error);
      alert("Unable to open attendance for this weekly slot right now.");
    } finally {
      setCreatingFixedSessionKey(null);
    }
  }

  function updateAttendance(sessionId, student, updates) {
    const docId = student.studentUid || student.studentEmail || "student";
    setDoc(
      doc(db, "sessions", sessionId, "attendance", docId),
      {
        sessionId,
        courseId: selectedSession?.courseId ?? "",
        studentUid: student.studentUid || "",
        studentEmail: student.studentEmail || "",
        studentName: student.studentName || student.studentEmail || "Student",
        status: updates.status,
        remark: updates.remark ?? "",
        markedAt: serverTimestamp(),
        markedBy: sessionUser?.email || "instructor",
      },
      { merge: true }
    ).catch((error) => {
      console.error("Failed to update attendance", error);
      alert("Unable to update attendance. Please try again.");
    });
  }

  if (loading || !sessionUser || sessionUser.role !== "teacher") {
    return null;
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f2f6fc 0%, #f7faff 45%, #ffffff 100%)",
        fontFamily: "'Manrope', 'Segoe UI', 'Trebuchet MS', sans-serif",
        padding: "38px 20px 56px",
      }}
    >
      <section
        style={{
          maxWidth: "1320px",
          margin: "0 auto",
          borderRadius: "26px",
          backgroundColor: "#ffffff",
          boxShadow: "0 24px 70px rgba(15, 23, 42, 0.12)",
          border: "1px solid rgba(191,219,254,0.45)",
          padding: "34px",
          display: "grid",
          gap: "24px",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <p
              style={{
                display: "inline-flex",
                padding: "7px 14px",
                borderRadius: "999px",
                backgroundColor: "rgba(14,116,144,0.13)",
                color: "#0e7490",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.15em",
              }}
            >
              SCHEDULE & ATTENDANCE
            </p>
            <h1
              style={{
                marginTop: "14px",
                fontSize: "38px",
                lineHeight: 1.15,
                fontWeight: 800,
                color: "#0f172a",
              }}
            >
              Manage lesson schedule and attendance
            </h1>
            <p style={{ marginTop: "10px", color: "#334155", fontSize: "15px", maxWidth: "760px" }}>
              Keep your teaching week clean and actionable: publish sessions, handle reschedules, and mark
              attendance from one place.
            </p>
          </div>
          <Link
            href="/teacher/dashboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 15px",
              borderRadius: "12px",
              border: "1px solid rgba(148,163,184,0.5)",
              color: "#0f172a",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Back to dashboard
          </Link>
        </header>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          {[
            { key: "calendar", label: "Calendar" },
            { key: "attendance", label: "Attendance" },
            { key: "requests", label: `Requests (${pendingRequests.length})` },
          ].map((item) => {
            const isActive = activeScheduleTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveScheduleTab(item.key)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "7px 12px",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: isActive ? "#0369a1" : "#334155",
                  border: isActive
                    ? "1px solid rgba(14,165,233,0.5)"
                    : "1px solid rgba(148,163,184,0.35)",
                  backgroundColor: isActive ? "rgba(224,242,254,0.85)" : "white",
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* 两列布局：左主体，右侧粘性概要/待办 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            gap: "20px",
            alignItems: "start",
          }}
        >
          {/* 左列 */}
          <div style={{ display: "grid", gap: "18px" }}>
            {activeScheduleTab === "calendar" && fixedWeeklyCourseGroups.length > 0 && (
              <section
                id="fixed-slots"
                style={{
                  borderRadius: "20px",
                  border: "1px solid rgba(203,213,225,0.75)",
                  padding: "18px",
                  backgroundColor: "#fbfdff",
                  display: "grid",
                  gap: "12px",
                }}
              >
                <header
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "grid", gap: "4px" }}>
                    <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", color: "#0ea5a4" }}>
                      RECURRING CLASSES
                    </p>
                    <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#0f172a" }}>
                      Fixed weekly slots
                    </h3>
                    <p style={{ margin: 0, fontSize: "12px", color: "#475569" }}>
                      Grouped by course. Expand to view slot details and jump to attendance.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={expandAllFixedCourseGroups}
                      style={{
                        padding: "6px 10px",
                        borderRadius: "999px",
                        border: "1px solid rgba(14,165,233,0.35)",
                        backgroundColor: "rgba(224,242,254,0.85)",
                        color: "#0369a1",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Expand all
                    </button>
                    <button
                      type="button"
                      onClick={collapseAllFixedCourseGroups}
                      style={{
                        padding: "6px 10px",
                        borderRadius: "999px",
                        border: "1px solid rgba(148,163,184,0.4)",
                        backgroundColor: "white",
                        color: "#334155",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Collapse all
                    </button>
                  </div>
                </header>

                <div style={{ display: "grid", gap: "10px" }}>
                  {fixedWeeklyCourseGroups.map((group) => {
                    const isExpanded = expandedFixedCourseIds[group.courseId] ?? false;
                    return (
                      <article
                        key={group.courseId}
                        style={{
                          borderRadius: "14px",
                          border: "1px solid rgba(226,232,240,0.9)",
                          padding: "14px",
                          backgroundColor: "#f8fafc",
                          display: "grid",
                          gap: "10px",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleFixedCourseGroup(group.courseId)}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "10px",
                            flexWrap: "wrap",
                            padding: 0,
                            border: "none",
                            backgroundColor: "transparent",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <div>
                            <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>
                              {group.courseTitle}
                            </p>
                            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#94a3b8" }}>
                              {group.slots.length} slot{group.slots.length > 1 ? "s" : ""} ·{" "}
                              {group.studentCount} student{group.studentCount > 1 ? "s" : ""}
                            </p>
                          </div>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              minWidth: "28px",
                              height: "28px",
                              borderRadius: "10px",
                              border: "1px solid rgba(148,163,184,0.35)",
                              backgroundColor: "white",
                              color: "#334155",
                              fontWeight: 600,
                            }}
                          >
                            {isExpanded ? "−" : "+"}
                          </span>
                        </button>

                        {isExpanded && (
                          <div style={{ display: "grid", gap: "8px" }}>
                            {group.slots.map((slot) => {
                              const isCreating = creatingFixedSessionKey === slot.key;
                              const studentPreview = slot.students.slice(0, 2);
                              const hiddenStudentCount = Math.max(0, slot.students.length - studentPreview.length);
                              return (
                                <div
                                  key={slot.key}
                                  style={{
                                    borderRadius: "12px",
                                    border: "1px solid rgba(203,213,225,0.9)",
                                    padding: "10px 12px",
                                    backgroundColor: "white",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    gap: "10px",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <div style={{ display: "grid", gap: "6px" }}>
                                    <p style={{ margin: 0, fontSize: "13px", color: "#0f172a", fontWeight: 600 }}>
                                      {slot.slotLabel}
                                    </p>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                      {studentPreview.map((student) => (
                                        <span
                                          key={`${slot.key}-${student.studentUid || student.studentEmail}`}
                                          style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            padding: "2px 8px",
                                            borderRadius: "999px",
                                            fontSize: "11px",
                                            color: "#1d4ed8",
                                            backgroundColor: "rgba(219,234,254,0.9)",
                                            fontWeight: 600,
                                          }}
                                        >
                                          {student.studentName}
                                        </span>
                                      ))}
                                      {hiddenStudentCount > 0 && (
                                        <span
                                          style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            padding: "2px 8px",
                                            borderRadius: "999px",
                                            fontSize: "11px",
                                            color: "#334155",
                                            backgroundColor: "rgba(226,232,240,0.85)",
                                            fontWeight: 600,
                                          }}
                                        >
                                          +{hiddenStudentCount} more
                                        </span>
                                      )}
                                    </div>
                                    <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
                                      Next class: {slot.nextLabel}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenFixedAttendance(slot)}
                                    disabled={isCreating}
                                    style={{
                                      padding: "8px 12px",
                                      borderRadius: "10px",
                                      border: "1px solid rgba(34,197,94,0.4)",
                                      backgroundColor: "white",
                                      color: "#15803d",
                                      fontWeight: 600,
                                      cursor: isCreating ? "not-allowed" : "pointer",
                                      opacity: isCreating ? 0.6 : 1,
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {isCreating
                                      ? "Opening..."
                                      : slot.usingScheduledSession
                                      ? "Open scheduled session"
                                      : slot.matchingSession
                                      ? "Open attendance"
                                      : "Create next fixed session"}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {activeScheduleTab === "requests" && (
              <section
                id="reschedule-requests"
                style={{
                  borderRadius: "20px",
                  border: "1px solid rgba(203,213,225,0.75)",
                  padding: "18px",
                  backgroundColor: "#f8fbff",
                  display: "grid",
                  gap: "12px",
                }}
              >
                <header
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "10px",
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", color: "#0ea5a4" }}>
                      REQUEST INBOX
                    </p>
                    <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", marginTop: "4px" }}>Reschedule requests</h2>
                    <p style={{ fontSize: "13px", color: "#475569", marginTop: "4px" }}>
                      Review make-up lesson requests submitted by students.
                    </p>
                  </div>
                </header>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {[
                    { key: "pending", label: `Pending (${pendingRequests.length})` },
                    { key: "all", label: `All (${rescheduleRequests.length})` },
                    { key: "resolved", label: `Resolved (${resolvedRequests.length})` },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setRequestFilter(option.key)}
                      style={{
                        padding: "6px 11px",
                        borderRadius: "999px",
                        border:
                          requestFilter === option.key
                            ? "1px solid rgba(37,99,235,0.5)"
                            : "1px solid rgba(148,163,184,0.4)",
                        backgroundColor: requestFilter === option.key ? "rgba(219,234,254,0.95)" : "white",
                        color: requestFilter === option.key ? "#1d4ed8" : "#475569",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
                  {[
                    {
                      label: "Overdue",
                      value: pendingQueueCounts.overdue,
                      color: "#b91c1c",
                      bg: "rgba(254,226,226,0.9)",
                    },
                    {
                      label: "Urgent",
                      value: pendingQueueCounts.urgent,
                      color: "#c2410c",
                      bg: "rgba(255,237,213,0.9)",
                    },
                    {
                      label: "This week",
                      value: pendingQueueCounts.thisWeek,
                      color: "#1d4ed8",
                      bg: "rgba(219,234,254,0.9)",
                    },
                    {
                      label: "Later",
                      value: pendingQueueCounts.later,
                      color: "#334155",
                      bg: "rgba(226,232,240,0.85)",
                    },
                  ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      borderRadius: "10px",
                      padding: "8px 10px",
                      backgroundColor: item.bg,
                      display: "grid",
                      gap: "2px",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, color: item.color }}>{item.label}</p>
                    <p style={{ margin: 0, fontSize: "20px", fontWeight: 800, color: "#0f172a" }}>{item.value}</p>
                  </div>
                ))}
                </div>

                {!filteredRequests.length ? (
                  <p style={{ fontSize: "13px", color: "#475569" }}>
                    {requestFilter === "pending"
                      ? "No pending requests at the moment."
                      : requestFilter === "resolved"
                      ? "No resolved requests yet."
                      : "No requests found."}
                  </p>
                ) : (
                  <div style={{ display: "grid", gap: "12px", maxHeight: "900px", overflowY: "auto", paddingRight: "2px" }}>
                    {filteredPendingRequestGroups
                      .filter((group) => group.items.length > 0)
                      .map((group) => (
                        <section key={group.key} style={{ display: "grid", gap: "10px" }}>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "5px 10px",
                              borderRadius: "999px",
                              fontSize: "12px",
                              fontWeight: 700,
                              color: group.badgeColor,
                              backgroundColor: group.badgeBg,
                              justifySelf: "start",
                            }}
                          >
                            {group.label} ({group.items.length})
                          </div>
                          <div style={{ display: "grid", gap: "10px" }}>
                            {group.items.map((request) => renderRequestCard(request, { tone: group }))}
                          </div>
                        </section>
                      ))}

                    {filteredResolvedRequests.length > 0 && (
                      <section style={{ display: "grid", gap: "10px" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "5px 10px",
                            borderRadius: "999px",
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "#475569",
                            backgroundColor: "rgba(226,232,240,0.85)",
                            justifySelf: "start",
                          }}
                        >
                          Resolved ({filteredResolvedRequests.length})
                        </div>
                        <div style={{ display: "grid", gap: "10px" }}>
                          {visibleResolvedRequests.map((request) => renderRequestCard(request))}
                        </div>
                        {(hasMoreResolvedRequests || resolvedVisibleCount > RESOLVED_REQUESTS_BATCH) && (
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            {hasMoreResolvedRequests && (
                              <button
                                type="button"
                                onClick={() =>
                                  setResolvedVisibleCount((previous) => previous + RESOLVED_REQUESTS_BATCH)
                                }
                                style={{
                                  padding: "7px 12px",
                                  borderRadius: "999px",
                                  border: "1px solid rgba(37,99,235,0.35)",
                                  backgroundColor: "rgba(219,234,254,0.85)",
                                  color: "#1d4ed8",
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                Load more resolved ({filteredResolvedRequests.length - visibleResolvedRequests.length} left)
                              </button>
                            )}
                            {resolvedVisibleCount > RESOLVED_REQUESTS_BATCH && (
                              <button
                                type="button"
                                onClick={() => setResolvedVisibleCount(RESOLVED_REQUESTS_BATCH)}
                                style={{
                                  padding: "7px 12px",
                                  borderRadius: "999px",
                                  border: "1px solid rgba(148,163,184,0.4)",
                                  backgroundColor: "white",
                                  color: "#334155",
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                Show latest {RESOLVED_REQUESTS_BATCH}
                              </button>
                            )}
                          </div>
                        )}
                      </section>
                    )}
                  </div>
                )}
              </section>
            )}
            {/* 即将到来 / 历史会话列表 */}
            {(activeScheduleTab === "calendar" || activeScheduleTab === "attendance") && (
              <section
                id="upcoming-sessions"
                style={{
                  borderRadius: "20px",
                  border: "1px solid rgba(203,213,225,0.75)",
                  padding: "18px",
                  backgroundColor: "#fbfdff",
                  display: "grid",
                  gap: "12px",
                }}
              >
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                  <div>
                    <p style={{ margin: 0, fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", color: "#0ea5a4" }}>
                      SESSION QUEUE
                    </p>
                    <h3 style={{ margin: "4px 0 0", fontSize: "20px", fontWeight: 700, color: "#0f172a" }}>Upcoming sessions</h3>
                    <p style={{ margin: 0, fontSize: "12px", color: "#475569" }}>
                      Showing {filteredUpcomingSessions.length} of {sessionsByDate.upcoming.length} scheduled sessions.
                    </p>
                  </div>
                </header>
                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    flexWrap: "wrap",
                    alignItems: "flex-start",
                  }}
                >
                  <label
                    style={{
                      display: "grid",
                      gap: "5px",
                      fontSize: "12px",
                      color: "#334155",
                      fontWeight: 600,
                      flex: "1 1 260px",
                      minWidth: "260px",
                    }}
                  >
                    Course
                    <select
                      value={sessionCourseFilter}
                      onChange={(event) => setSessionCourseFilter(event.target.value)}
                      style={{
                        padding: "9px 11px",
                        borderRadius: "10px",
                        border: "1px solid rgba(148,163,184,0.45)",
                        backgroundColor: "white",
                        color: "#0f172a",
                        fontSize: "13px",
                      }}
                    >
                      <option value="all">All courses</option>
                      {sessionCourseOptions.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    style={{
                      display: "grid",
                      gap: "5px",
                      fontSize: "12px",
                      color: "#334155",
                      fontWeight: 600,
                      flex: "1 1 200px",
                      minWidth: "200px",
                    }}
                  >
                    Range
                    <select
                      value={sessionRangeFilter}
                      onChange={(event) => setSessionRangeFilter(event.target.value)}
                      style={{
                        padding: "9px 11px",
                        borderRadius: "10px",
                        border: "1px solid rgba(148,163,184,0.45)",
                        backgroundColor: "white",
                        color: "#0f172a",
                        fontSize: "13px",
                      }}
                    >
                      <option value="all">All upcoming</option>
                      <option value="today">Today</option>
                      <option value="next7">Next 7 days</option>
                    </select>
                  </label>
                  <label
                    style={{
                      display: "grid",
                      gap: "5px",
                      fontSize: "12px",
                      color: "#334155",
                      fontWeight: 600,
                      flex: "1 1 320px",
                      minWidth: "260px",
                    }}
                  >
                    Search
                    <input
                      type="search"
                      value={sessionSearchKeyword}
                      onChange={(event) => setSessionSearchKeyword(event.target.value)}
                      placeholder="Search title, date, location..."
                      style={{
                        padding: "9px 11px",
                        borderRadius: "10px",
                        border: "1px solid rgba(148,163,184,0.45)",
                        backgroundColor: "white",
                        color: "#0f172a",
                        fontSize: "13px",
                      }}
                    />
                  </label>
                </div>
                <div style={{ display: "grid", gap: "10px" }}>
                  {filteredUpcomingSessions.length === 0 ? (
                    <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                      No upcoming sessions match your current filters.
                    </p>
                  ) : (
                    <div style={{ display: "grid", gap: "10px" }}>
                      {upcomingSessionGroups
                        .filter((group) => group.sessions.length > 0)
                        .map((group) => {
                          const isExpanded = expandedUpcomingGroups[group.key] ?? true;
                          return (
                            <article
                              key={group.key}
                              style={{
                                borderRadius: "12px",
                                border: "1px solid rgba(226,232,240,0.9)",
                                backgroundColor: "#f8fafc",
                                padding: "10px",
                                display: "grid",
                                gap: "10px",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => toggleUpcomingGroup(group.key)}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  gap: "8px",
                                  border: "none",
                                  backgroundColor: "transparent",
                                  padding: 0,
                                  cursor: "pointer",
                                }}
                              >
                                <span style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>
                                  {group.label} ({group.sessions.length})
                                </span>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minWidth: "24px",
                                    height: "24px",
                                    borderRadius: "8px",
                                    border: "1px solid rgba(148,163,184,0.4)",
                                    backgroundColor: "white",
                                    color: "#334155",
                                    fontSize: "12px",
                                    fontWeight: 700,
                                  }}
                                >
                                  {isExpanded ? "−" : "+"}
                                </span>
                              </button>

                              {isExpanded && (
                                <div style={{ display: "grid", gap: "10px" }}>
                                  {group.sessions.map((session) => (
                                    <SessionCard
                                      key={session.id}
                                      session={session}
                                      course={courseCatalog.find((c) => c.id === session.courseId)}
                                      onManage={() => openAttendanceSession(session.id)}
                                      onDelete={() => handleDeleteSession(session.id)}
                                    />
                                  ))}
                                </div>
                              )}
                            </article>
                          );
                        })}
                    </div>
                  )}
                </div>
              </section>
            )}

            {(activeScheduleTab === "calendar" || activeScheduleTab === "attendance") &&
              sessionsByDate.past.length > 0 && (
              <section
                style={{
                  borderRadius: "20px",
                  border: "1px solid rgba(203,213,225,0.75)",
                  padding: "18px",
                  backgroundColor: "#fbfdff",
                  display: "grid",
                  gap: "12px",
                }}
              >
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#0f172a" }}>Past sessions</h3>
                    <p style={{ margin: 0, fontSize: "12px", color: "#475569" }}>
                      Showing {filteredPastSessions.length} of {sessionsByDate.past.length} past sessions.
                    </p>
                  </div>
                </header>
                <div style={{ display: "grid", gap: "10px" }}>
                  {filteredPastSessions.length === 0 ? (
                    <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                      No past sessions match your current filters.
                    </p>
                  ) : (
                    filteredPastSessions.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        course={courseCatalog.find((c) => c.id === session.courseId)}
                        onManage={() => openAttendanceSession(session.id)}
                        onDelete={() => handleDeleteSession(session.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            )}

            {activeScheduleTab === "attendance" && !selectedSession && (
              <section
                id="attendance-panel"
                style={{
                  borderRadius: "20px",
                  border: "1px solid rgba(203,213,225,0.75)",
                  padding: "20px",
                  backgroundColor: "#fbfdff",
                  display: "grid",
                  gap: "8px",
                }}
              >
                <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "#0f172a" }}>
                  Attendance
                </h2>
                <p style={{ margin: 0, fontSize: "13px", color: "#475569" }}>
                  Select a session from Upcoming sessions or Fixed weekly slots to start marking attendance.
                </p>
              </section>
            )}

            {/* 出勤面板（若选中某会话） */}
           {activeScheduleTab === "attendance" && selectedSession && (
                 <section
                id="attendance-panel"
                style={{
                  borderRadius: "20px",
                  border: "1px solid rgba(203,213,225,0.75)",
                  padding: "24px",
                  backgroundColor: "#fbfdff",
                  display: "grid",
                  gap: "18px",
                }}
              >
                <header
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "12px",
                  }}
                >
                  <div>
                    <h2
                      style={{
                        fontSize: "22px",
                        fontWeight: 700,
                        color: "#0f172a",
                      }}
                    >
                      Attendance · {selectedSession.title}
                    </h2>
                    <p
                      style={{
                        fontSize: "13px",
                        color: "#475569",
                        marginTop: "4px",
                      }}
                    >
                      {selectedSession.date
                        ? new Date(
                            `${selectedSession.date}T${
                              selectedSession.startTime || "00:00"
                            }`
                          ).toLocaleString()
                        : ""}
                      {selectedSession.location
                        ? ` · ${selectedSession.location}`
                        : ""}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedSessionId(null)}
                    style={{
                      alignSelf: "flex-start",
                      padding: "8px 14px",
                      borderRadius: "10px",
                      border: "1px solid rgba(148,163,184,0.4)",
                      backgroundColor: "white",
                      color: "#475569",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Close
                  </button>
                </header>

                {studentsForSelectedSession.length === 0 ? (
                  <p
                    style={{
                      fontSize: "13px",
                      color: "#475569",
                    }}
                  >
                    No students enrolled in this course yet. Once students enroll,
                    they will appear here for attendance.
                  </p>
                ) : (
                  <div style={{ display: "grid", gap: "14px" }}>
                    {studentsForSelectedSession.map((student) => {
                      const attendanceKey = `${selectedSession.id}::${
                        student.studentUid || student.studentEmail || "student"
                      }`;
                      const attendance = attendanceMap.get(attendanceKey) || null;

                      return (
                        <div
                          key={`${selectedSession.id}-${
                            student.studentUid || student.studentEmail
                          }`}
                          style={{
                            borderRadius: "14px",
                            border: "1px solid rgba(226,232,240,0.9)",
                            padding: "16px",
                            backgroundColor: "#f8fafc",
                            display: "grid",
                            gap: "10px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              flexWrap: "wrap",
                              gap: "8px",
                            }}
                          >
                            <div>
                              <p
                                style={{
                                  fontSize: "13px",
                                  fontWeight: 600,
                                  color: "#0f172a",
                                }}
                              >
                                {student.studentName}
                              </p>
                              <p
                                style={{
                                  fontSize: "12px",
                                  color: "#475569",
                                }}
                              >
                                {student.studentEmail}
                              </p>
                            </div>

                            <div
                              style={{
                                display: "flex",
                                gap: "6px",
                                flexWrap: "wrap",
                              }}
                            >
                              {attendanceStatuses.map((status) => (
                                <button
                                  key={status.value}
                                  type="button"
                                  onClick={() =>
                                    updateAttendance(selectedSession.id, student, {
                                      status: status.value,
                                      remark: attendance?.remark ?? "",
                                    })
                                  }
                                  style={{
                                    padding: "6px 12px",
                                    borderRadius: "999px",
                                    border:
                                      attendance?.status === status.value
                                        ? `2px solid ${status.color}`
                                        : "1px solid rgba(148,163,184,0.4)",
                                    backgroundColor:
                                      attendance?.status === status.value
                                        ? status.background
                                        : "white",
                                    color:
                                      attendance?.status === status.value
                                        ? status.color
                                        : "#475569",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                  }}
                                >
                                  {status.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <label style={{ display: "grid", gap: "6px" }}>
                            <span
                              style={{
                                fontSize: "12px",
                                fontWeight: 600,
                                color: "#0f172a",
                              }}
                            >
                              Instructor remark
                            </span>
                            <textarea
                              value={attendance?.remark ?? ""}
                              onChange={(event) =>
                                updateAttendance(selectedSession.id, student, {
                                  status: attendance?.status ?? "present",
                                  remark: event.target.value,
                                })
                              }
                              rows={2}
                              placeholder="Optional notes about this lesson."
                              style={{
                                padding: "10px 12px",
                                borderRadius: "10px",
                                border: "1px solid #cbd5f5",
                                backgroundColor: "white",
                                color: "#0f172a",
                                colorScheme: "light",
                                fontSize: "13px",
                                resize: "vertical",
                              }}
                            />
                          </label>

                          <p
                            style={{
                              fontSize: "11px",
                              color: "#94a3b8",
                            }}
                          >
                            {attendance?.markedAt
                              ? `Last updated ${new Date(
                                  attendance.markedAt
                                ).toLocaleString()}`
                              : "Status not marked yet."}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

          </div>

                   <aside
            style={{
              display: "grid",
              gap: "16px",
              alignContent: "start",
            }}
          >
            {/* This week at a glance */}
            <div
              style={{
                borderRadius: "20px",
                border: "1px solid rgba(191,219,254,0.55)",
                padding: "18px",
                backgroundColor: "#fbfdff",
                boxShadow: "0 12px 28px rgba(15,23,42,0.1)",
                display: "grid",
                gap: "10px",
              }}
            >
              <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>
                This week at a glance
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
                <div style={{ padding: "10px", borderRadius: "10px", background: "#eff6ff" }}>
                  <p style={{ margin: 0, fontSize: "11px", color: "#2563eb", fontWeight: 700 }}>Upcoming</p>
                  <p style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 800, color: "#0f172a" }}>
                    {summaryCounts.upcomingCount}
                  </p>
                </div>
                <div style={{ padding: "10px", borderRadius: "10px", background: "#f0fdf4" }}>
                  <p style={{ margin: 0, fontSize: "11px", color: "#15803d", fontWeight: 700 }}>This week</p>
                  <p style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 800, color: "#0f172a" }}>
                    {summaryCounts.thisWeekCount}
                  </p>
                </div>
                <div style={{ padding: "10px", borderRadius: "10px", background: "#fff1f2" }}>
                  <p style={{ margin: 0, fontSize: "11px", color: "#b91c1c", fontWeight: 700 }}>Requests</p>
                  <p style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 800, color: "#0f172a" }}>
                    {pendingRequests.length}
                  </p>
                </div>
                <div style={{ padding: "10px", borderRadius: "10px", background: "#ecfeff" }}>
                  <p style={{ margin: 0, fontSize: "11px", color: "#0369a1", fontWeight: 700 }}>Weekly slots</p>
                  <p style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 800, color: "#0f172a" }}>
                    {fixedWeeklyCourseGroups.length}
                  </p>
                </div>
              </div>
            </div>

          </aside>
        </div>
      </section>
    </main>
  );
}
function SessionCard({ session, course, onManage, onDelete }) {
  return (
    <article
      style={{
        borderRadius: "14px",
        border: "1px solid rgba(203,213,225,0.75)",
        padding: "16px",
        backgroundColor: "#f8fafc",
        display: "grid",
        gap: "10px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
          alignItems: "center",
        }}
      >
        <div>
          <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>
            {session.title || course?.title || "Lesson"}
          </h3>
          <p style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
            {course?.title ? `${course.title}  ` : ""}
            {formatSessionDateTime(session)}
            {session.location ? `  ${session.location}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onManage}
            style={{
              padding: "8px 14px",
              borderRadius: "999px",
              border: "1px solid rgba(34,197,94,0.4)",
              backgroundColor: "white",
              color: "#15803d",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Manage attendance
          </button>
          <button
            type="button"
            onClick={onDelete}
            style={{
              padding: "8px 14px",
              borderRadius: "999px",
              border: "1px solid rgba(239,68,68,0.4)",
              backgroundColor: "white",
              color: "#b91c1c",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {session.notes && (
        <p style={{ fontSize: "12px", color: "#475569" }}>
          <span style={{ fontWeight: 600, color: "#0f172a" }}>Notes:</span> {session.notes}
        </p>
      )}
    </article>
  );
} 
