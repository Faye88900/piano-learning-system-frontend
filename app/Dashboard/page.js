"use client";

import Link from "next/link";
import Image from "next/image";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut } from "firebase/auth";
import {addDoc,collection,collectionGroup,doc,onSnapshot,orderBy,query,serverTimestamp,updateDoc,where,} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";
import { courseCatalog } from "@/lib/courseCatalog";

const roleLabels = {
  student: "Student",
  teacher: "Teacher",
  admin: "Admin",
};

function hasPaidAccess(enrollment) {
  if (!enrollment) return false;
  const enrollmentStatus =
    typeof enrollment.status === "string" ? enrollment.status.toLowerCase() : "";
  return (
    enrollment.paymentStatus === "paid" ||
    enrollmentStatus === "paid" ||
    Boolean(enrollment.paidAt || enrollment.paymentReceiptUrl || enrollment.paymentIntentId)
  );
}

function toMillis(value) {
  if (!value) return NaN;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    const ms = date instanceof Date ? date.getTime() : NaN;
    return Number.isFinite(ms) ? ms : NaN;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function getEnrollmentSortTime(entry) {
  const candidates = [entry?.paidAt, entry?.enrolledAt, entry?.updatedAt];
  for (const value of candidates) {
    if (!value) continue;
    const ms = toMillis(value);
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

function choosePreferredEnrollment(current, next) {
  if (!current) return next;

  const currentPaid = hasPaidAccess(current);
  const nextPaid = hasPaidAccess(next);
  if (currentPaid !== nextPaid) {
    return nextPaid ? next : current;
  }

  const currentTime = getEnrollmentSortTime(current);
  const nextTime = getEnrollmentSortTime(next);
  if (nextTime !== currentTime) {
    return nextTime > currentTime ? next : current;
  }

  const currentDeterministic = typeof current.docId === "string" && current.docId.includes("_");
  const nextDeterministic = typeof next.docId === "string" && next.docId.includes("_");
  if (currentDeterministic !== nextDeterministic) {
    return nextDeterministic ? next : current;
  }

  return current;
}

export default function DashboardPage() {

  const router = useRouter();
  const { sessionUser, loading } = useSessionUser();
  const currentUid = auth.currentUser?.uid;
  const [enrolledCourses, setEnrolledCourses] = useState([]);
  const [teacherMaterials, setTeacherMaterials] = useState([]);
  const [lessonSessions, setLessonSessions] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [courseProgressRecords, setCourseProgressRecords] = useState([]);
  const [rescheduleRequests, setRescheduleRequests] = useState([]);
  const [submittingRequestSessionId, setSubmittingRequestSessionId] = useState(null);
  const [activeTab, setActiveTab] = useState("courses");
  const [searchInputValue, setSearchInputValue] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [showPastAttendance, setShowPastAttendance] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!sessionUser) {
      router.push("/login");
      return;
    }
    if (sessionUser.role === "teacher") {
      router.push("/teacher/dashboard");
    }
  }, [sessionUser, loading, router]);

  useEffect(() => {
    if (!sessionUser?.uid || sessionUser.role !== "student") {
      setEnrolledCourses([]);              
      return;
      // 仅当学生登入时，才执行报名资料查询
    }

    const q = query(
      //定义查询条件
      collection(db, "enrollments"),
      where("studentUid", "==", sessionUser.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => { 
        const records = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            const courseId = data.courseId ?? data.id;
            if (!courseId) return null;
            return { ...data, docId: docSnap.id, id: courseId };
          })
          .filter(Boolean);
        const deduped = new Map();
        for (const entry of records) {
          const previous = deduped.get(entry.id);
          deduped.set(entry.id, choosePreferredEnrollment(previous, entry));
        }
        setEnrolledCourses(Array.from(deduped.values()));
      },
      (error) => {
        console.error("Failed to load enrollments", error);
        setEnrolledCourses([]);
      }
    );

    return () => unsubscribe();
  }, [sessionUser]);

  useEffect(() => {
    if (!sessionUser?.uid || !enrolledCourses.length) {
      setLessonSessions([]);
      return;
    }
    
    const sessionMap = new Map();
    const unsubscribes = [];

    const updateState = () => {
      const list = Array.from(sessionMap.values());
      setLessonSessions(list);
    };

    for (const entry of enrolledCourses) {
      const sessionsQuery = query(collection(db, "sessions"), where("courseId", "==", entry.id));
      const unsubscribe = onSnapshot(
        sessionsQuery,
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === "removed") {
              sessionMap.delete(change.doc.id);
            } else {
              const data = change.doc.data();
              const createdAt =
                data.createdAt && typeof data.createdAt.toDate === "function"
                  ? data.createdAt.toDate().toISOString()
                  : data.createdAt ?? null;

              sessionMap.set(change.doc.id, {
                id: change.doc.id,
                ...data,
                createdAt,
              });
            }
          });
          updateState();
        },
        (error) => {
          console.error("Failed to load lesson sessions", error);
        }
      );
      unsubscribes.push(unsubscribe);
    }

    return () => {
      unsubscribes.forEach((fn) => fn());
    };
  }, [enrolledCourses, sessionUser?.uid]);

//student Attendance records
  useEffect(() => {
    if (!sessionUser || !currentUid) {
      setAttendanceRecords([]);
      return;
    }

    const recordMap = new Map();
    const updateState = () => {
      setAttendanceRecords(Array.from(recordMap.values()));
    };

    const unsubscribes = [];

    if (sessionUser.uid) {
      const uidQuery = query(
        collectionGroup(db, "attendance"),
        where("studentUid", "==", sessionUser.uid)
      );
      unsubscribes.push(
        onSnapshot(
          uidQuery,
          (snapshot) => {
            snapshot.docChanges().forEach((change) => {
              const data = change.doc.data();
              const markedAt =
                data.markedAt && typeof data.markedAt.toDate === "function"
                  ? data.markedAt.toDate().toISOString()
                  : data.markedAt ?? null;
              const record = {
                id: change.doc.id,
                ...data,
                markedAt,
              };
              if (change.type === "removed") {
                recordMap.delete(change.doc.ref.path);
              } else {
                recordMap.set(change.doc.ref.path, record);
              }
            });
            updateState();
          },
          (error) => {
            console.error("Failed to load attendance records (uid)", error);
          }
        )
      );
    }

    //用 email 查 attendance
    if (sessionUser.email) {
      const emailQuery = query(
        collectionGroup(db, "attendance"),
        where("studentEmail", "==", sessionUser.email)
      );
      unsubscribes.push(
        onSnapshot(
          emailQuery,
          (snapshot) => {
            snapshot.docChanges().forEach((change) => {
              const data = change.doc.data();
              const markedAt =
                data.markedAt && typeof data.markedAt.toDate === "function"
                  ? data.markedAt.toDate().toISOString()
                  : data.markedAt ?? null;
              const record = {
                id: change.doc.id,
                ...data,
                markedAt,
              };
              if (change.type === "removed") {
                recordMap.delete(change.doc.ref.path);
              } else {
                recordMap.set(change.doc.ref.path, record);
              }
            });
            updateState();
          },
          (error) => {
            console.error("Failed to load attendance records (email)", error);
          }
        )
      );
    }

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [sessionUser, currentUid]);

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
        where("studentUid", "==", sessionUser.uid)
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
        where("studentEmail", "==", sessionUser.email)
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
  }, [sessionUser]);

  //Student see materials 
  useEffect(() => {
    if (!sessionUser) {
      setTeacherMaterials([]);
      return;
    }

    const materialsQuery = query(collection(db, "materials"), orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      materialsQuery,
      (snapshot) => {
        const items = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate().toISOString()
              : data.createdAt ?? null;
          const updatedAt =
            data.updatedAt && typeof data.updatedAt.toDate === "function"
              ? data.updatedAt.toDate().toISOString()
              : data.updatedAt ?? null;

          return {
            id: docSnap.id,
            ...data,
            createdAt,
            updatedAt,
          };
        });
        setTeacherMaterials(items);
      },
      (error) => {
        console.error("Failed to load teaching materials", error);
        setTeacherMaterials([]);
      }
    );

    return () => unsubscribe();
  }, [sessionUser]);

  useEffect(() => {
    if (!sessionUser?.uid) {
      setCourseProgressRecords([]);
      return;
    }

    const progressQuery = query(
      collection(db, "courseProgress"),
      where("studentUid", "==", sessionUser.uid)
    );

    const unsubscribe = onSnapshot(
      progressQuery,
      (snapshot) => {
        const records = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const courseId =
            data.courseId ??
            (typeof docSnap.id === "string" && docSnap.id.includes("::")
              ? docSnap.id.split("::").pop()
              : null);
          const updatedAt =
            data.updatedAt && typeof data.updatedAt.toDate === "function"
              ? data.updatedAt.toDate().toISOString()
              : data.updatedAt ?? null;
          return {
            id: docSnap.id,
            ...data,
            courseId,
            updatedAt,
          };
        });
        setCourseProgressRecords(records);
      },
      (error) => {
        console.error("Failed to load course progress", error);
        setCourseProgressRecords([]);
      }
    );

    return () => unsubscribe();
  }, [sessionUser?.uid]);

  //课程注册信息将直接显示。
  const enrollmentById = useMemo(() => {
    const map = new Map();
    for (const entry of enrolledCourses) {
      map.set(entry.id, entry);
    }
    return map;
  }, [enrolledCourses]);


  const progressByKey = useMemo(() => {
    const map = new Map();
    for (const record of courseProgressRecords) {
      if (record && record.id) {
        map.set(record.id, record);
      }
      if (record?.studentEmail && record?.courseId) {
        map.set(`${record.studentEmail}::${record.courseId}`, record);
      }
      if (record?.studentUid && record?.courseId) {
        map.set(`${record.studentUid}::${record.courseId}`, record);
      }
    }
    return map;
  }, [courseProgressRecords]);

  //合并给ui
  const enrichedEnrolledCourses = useMemo(() => {
    if (!enrolledCourses.length) return [];

    return enrolledCourses
      .map((entry) => {
        const course = courseCatalog.find((item) => item.id === entry.id);
        if (!course) return null;

        const teacherItems = teacherMaterials.filter(
          (material) =>
            material.courseId === course.id && material.visibleToStudents !== false
        );

        const progressKey = sessionUser?.email ? `${sessionUser.email}::${entry.id}` : null;
        const progressRecord = progressKey ? progressByKey.get(progressKey) : null;
        const resolvedProgress =
          typeof progressRecord?.progress === "number"
            ? progressRecord.progress
            : entry.progress ?? 0;

        return {
          ...course,
          teacherMaterials: teacherItems,
          enrollment: entry,
          progress: resolvedProgress,
          progressRecord,
        };
      })
      .filter(Boolean);
  }, [enrolledCourses, teacherMaterials, progressByKey, sessionUser]);

  const matchesCourseKeyword = (course, keyword) => {
    if (!keyword) return true;
    const haystacks = [
      course.title,
      course.description,
      course.headline,
      course.teacher,
      course.level,
    ];
    return haystacks.some(
      (text) => typeof text === "string" && text.toLowerCase().includes(keyword)
    );
  };

  const matchesMaterialKeyword = (resource, keyword) => {
    if (!keyword) return true;
    const haystacks = [resource.title, resource.label, resource.description, resource.type];
    return haystacks.some(
      (text) => typeof text === "string" && text.toLowerCase().includes(keyword)
    );
  };

  const filteredCourses = useMemo(() => {
    if (!searchKeyword) return courseCatalog;
    return courseCatalog.filter((course) => matchesCourseKeyword(course, searchKeyword));
  }, [searchKeyword]);

  const filteredMaterialCourses = useMemo(() => {
    if (!searchKeyword) return enrichedEnrolledCourses;
    return enrichedEnrolledCourses
      .map((course) => {
        const resources = course.teacherMaterials || [];
        const filteredResources = resources.filter((item) =>
          matchesMaterialKeyword(item, searchKeyword)
        );
        const courseMatches = matchesCourseKeyword(course, searchKeyword);
        if (!courseMatches && filteredResources.length === 0) {
          return null;
        }
        return {
          ...course,
          teacherMaterials: filteredResources.length ? filteredResources : resources,
        };
      })
      .filter(Boolean);
  }, [searchKeyword, enrichedEnrolledCourses]);


  async function handleCreateRescheduleRequest(requestContext, payload) {
    if (!sessionUser) return;
    if (!requestContext?.courseId) return;

    const requestedDate = payload.requestedDate?.trim();
    if (!requestedDate) {
      alert("Please choose a preferred make-up date.");
      return;
    }

    const requestTargetSession = requestContext.requestTargetSession || null;
    const requestSubmitKey =
      requestContext.requestSubmitKey ||
      (requestTargetSession?.id ? requestTargetSession.id : `course:${requestContext.courseId}`);
    setSubmittingRequestSessionId(requestSubmitKey);

    try {
      const sessionId = requestTargetSession?.id ?? "";
      const courseId = requestContext.courseId ?? "";
      const pendingMatches = (rescheduleRequests || []).filter((request) => {
        const status = String(request?.status || "pending").toLowerCase();
        if (status !== "pending") return false;
        if ((request?.studentUid || "") !== (sessionUser?.uid || "")) return false;
        if ((request?.courseId || "") !== courseId) return false;
        return (request?.sessionId || "") === sessionId;
      });
      const existingPending =
        pendingMatches.find(
          (request) =>
            String(request?.teacherUid || "").trim() ||
            String(request?.teacherEmail || "").trim()
        ) ||
        pendingMatches[0] ||
        null;
      const fallbackCourseRequest = (rescheduleRequests || []).find((request) => {
        if ((request?.courseId || "") !== courseId) return false;
        const hasTeacher = (request?.teacherUid || "").trim() || (request?.teacherEmail || "").trim();
        return Boolean(hasTeacher);
      });
      const fallbackSessionForCourse = (lessonSessions || []).find((session) => {
        if (session?.archived) return false;
        if ((session?.courseId || "") !== courseId) return false;
        return Boolean((session?.teacherUid || "").trim() || (session?.teacherEmail || "").trim());
      });

      const resolvedTeacherUid =
        (requestTargetSession?.teacherUid || "").trim() ||
        (requestContext.teacherUid || "").trim() ||
        (existingPending?.teacherUid || "").trim() ||
        (fallbackCourseRequest?.teacherUid || "").trim() ||
        (fallbackSessionForCourse?.teacherUid || "").trim();
      const resolvedTeacherEmail =
        (requestTargetSession?.teacherEmail || "").trim() ||
        (requestContext.teacherEmail || "").trim() ||
        (existingPending?.teacherEmail || "").trim() ||
        (fallbackCourseRequest?.teacherEmail || "").trim() ||
        (fallbackSessionForCourse?.teacherEmail || "").trim();
      const requestPayload = {
        sessionId,
        courseId,
        courseTitle: requestContext.courseTitle ?? "",
        sessionDate: requestTargetSession?.date ?? existingPending?.sessionDate ?? "",
        sessionStartTime: requestTargetSession?.startTime ?? existingPending?.sessionStartTime ?? "",
        teacherUid: resolvedTeacherUid,
        teacherEmail: resolvedTeacherEmail,
        studentUid: sessionUser.uid,
        studentEmail: sessionUser.email ?? "",
        studentName: sessionUser.profileName || sessionUser.email || "Student",
        requestedDate,
        requestedTime: payload.requestedTime?.trim() || "",
        message: payload.message?.trim() || "",
        requestMode: requestTargetSession?.id ? "session" : "course",
      };

      if (existingPending?.id) {
        await updateDoc(doc(db, "rescheduleRequests", existingPending.id), {
          ...requestPayload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "rescheduleRequests"), {
          ...requestPayload,
          status: "pending",
          createdAt: serverTimestamp(),
        });
      }
    } catch (error) {
      console.error("Failed to submit reschedule request", error);
      alert("Unable to submit your request. Please try again.");
    } finally {
      setSubmittingRequestSessionId(null);
    }
  }

  async function handleSignOut() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Failed to sign out", error);
    } finally {
      router.push("/login");
    }
  }

  //搜索功能
  function handleSearchExecute() {
    const keyword = searchInputValue.trim().toLowerCase();
    setSearchKeyword(keyword);

    if (!keyword) {
      setActiveTab("courses");
      return;
    }

    const courseMatch = courseCatalog.some((course) => matchesCourseKeyword(course, keyword));
    const materialMatch = enrichedEnrolledCourses.some((course) => {
      const resources = course.teacherMaterials || [];
      return (
        matchesCourseKeyword(course, keyword) ||
        resources.some((item) => matchesMaterialKeyword(item, keyword))
      );
    });

    if (courseMatch) {
      setActiveTab("courses");
    } else if (materialMatch) {
      setActiveTab("materials");
    } else {
      setActiveTab("courses");
    }
  }

  if (loading || !sessionUser) {
    return null;
  }

  const isStudent = sessionUser.role === "student";
  const isTeacher = sessionUser.role === "teacher";

  if (isTeacher) {
    return null;
  }

  const studentMaterialCount = enrichedEnrolledCourses.reduce((total, course) => {
    const resources = course.teacherMaterials || [];
    return total + resources.length;
  }, 0);
  const enrolledCourseIds = new Set(enrolledCourses.map((course) => course.id));
  const upcomingSessionCount = (lessonSessions || []).reduce((total, session) => {
    if (!session || session.archived) return total;
    if (session.courseId && !enrolledCourseIds.has(session.courseId)) return total;
    if (!session?.date) return total;
    const computed = new Date(`${session.date}T${session.startTime || "00:00"}`);
    if (Number.isNaN(computed.getTime())) {
      return total;
    }
    return computed.getTime() >= Date.now() ? total + 1 : total;
  }, 0);
  const pendingRequestCount = rescheduleRequests.filter(
    (request) => (request?.status || "pending") === "pending"
  ).length;
  const averageProgress =
    enrichedEnrolledCourses.length > 0
      ? Math.round(
          enrichedEnrolledCourses.reduce((sum, course) => {
            const numeric = Number(course.progress);
            return sum + (Number.isFinite(numeric) ? numeric : 0);
          }, 0) / enrichedEnrolledCourses.length
        )
      : 0;

  const studentStats = [
    { label: "Active courses", value: enrolledCourses.length },
    { label: "Avg. progress", value: `${averageProgress}%` },
    { label: "Upcoming lessons", value: upcomingSessionCount },
    { label: "Pending reschedules", value: pendingRequestCount },
  ];

  const studentTabs = [
    {
      id: "courses",
      label: "Courses",
      badge: searchKeyword
        ? filteredCourses.length
          ? `${filteredCourses.length} match${filteredCourses.length > 1 ? "es" : ""}`
          : "No matches"
        : enrolledCourses.length
        ? `${enrolledCourses.length} active`
        : "Browse catalog",
      title: "Course catalog & enrollment",
      description: "Explore available lessons and manage your enrollments.",
      content: (
        <StudentCourses
          courses={filteredCourses}
          enrollmentById={enrollmentById}
          searchActive={Boolean(searchKeyword)}
        />
      ),
    },
    {
      id: "materials",
      label: "Materials",
      badge: searchKeyword
        ? filteredMaterialCourses.length
          ? `${filteredMaterialCourses.length} course${filteredMaterialCourses.length > 1 ? "s" : ""}`
          : "No matches"
        : studentMaterialCount
        ? `${studentMaterialCount} shared`
        : "No files",
      title: "Learning library",
      description: "Download teacher-provided videos, sheet music, and assignments.",
      content: (
        <StudentMaterials
          enrolledCourses={filteredMaterialCourses}
          hasEnrollments={enrichedEnrolledCourses.length > 0}
          searchActive={Boolean(searchKeyword)}
        />
      ),
    },
    {
      id: "attendance",
      label: "Attendance",
      badge: upcomingSessionCount ? `${upcomingSessionCount} upcoming` : "No sessions",
      title: "Schedule & attendance",
      description: "Track lesson dates, attendance decisions, and submit reschedule requests.",
      content: (
        <StudentAttendance
          enrolledCourses={enrichedEnrolledCourses}
          lessonSessions={lessonSessions}
          attendanceRecords={attendanceRecords}
          studentEmail={sessionUser.email}
          rescheduleRequests={rescheduleRequests}
          onSubmitReschedule={handleCreateRescheduleRequest}
          submittingRequestId={submittingRequestSessionId}
          showPast={showPastAttendance}
          onToggleShowPast={() => setShowPastAttendance((prev) => !prev)}
        />
      ),
    },
    {
      id: "progress",
      label: "Progress",
      badge: `${averageProgress}% avg`,
      title: "Progress tracker",
      description: "Review completion percentages and instructor milestones.",
      content: <StudentProgress enrolledCourses={enrichedEnrolledCourses} />,
    },
  ];

  const activeTabDefinition =
    studentTabs.find((tab) => tab.id === activeTab) ?? studentTabs[0];

  const studentPrimaryNav = [
    {
      id: "courses",
      label: "Course Feed",
      description: "Browse and enroll",
      icon: "📚",
    },
    {
      id: "materials",
      label: "Materials",
      description: "Downloads & links",
      icon: "📁",
    },
    {
      id: "attendance",
      label: "Schedule",
      description: "Lessons & attendance",
      icon: "📆",
    },
    {
      id: "progress",
      label: "Progress",
      description: "Milestones & notes",
      icon: "📈",
    },
    {
      id: "payments",
      label: "Payments",
      description: "Receipts & history",
      icon: "💳",
      href: "/student/payments",
    },
  ];
  const studentQuickLinks = [
    {
      label: "Practice Log",
      href: "/practice-log",
      icon: "🎧",
    },
  ];


  return (
    <main
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, #eff6ff 0%, #dbeafe 30%, #f8fafc 100%)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        padding: "48px 24px",
      }}
    >
      {isStudent ? (
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            display: "flex",
            gap: "24px",
            flexWrap: "wrap",
            alignItems: "flex-start",
          }}
        >
          <StudentSidebar
            sessionUser={sessionUser}
            primaryNav={studentPrimaryNav}
            quickLinks={studentQuickLinks}
            activeTab={activeTabDefinition.id}
            onSelectTab={setActiveTab}
            onSignOut={handleSignOut}
          />
          <div style={{ flex: "1 1 640px", minWidth: "0", display: "grid", gap: "24px" }}>
            <Suspense fallback={null}>
              <PaymentNotice />
            </Suspense>
            <StudentHero
              sessionUser={sessionUser}
              upcomingLessons={upcomingSessionCount}
              pendingRequests={pendingRequestCount}
              searchValue={searchInputValue}
              onSearchInputChange={setSearchInputValue}
              onExecuteSearch={handleSearchExecute}
              onBrowseCourses={() => setActiveTab("courses")}
            />
            <StudentStatsBar stats={studentStats} />
            <StudentTabNav
              tabs={studentTabs}
              activeTab={activeTabDefinition.id}
              onSelect={setActiveTab}
            />
            <SectionCard
              title={activeTabDefinition.title}
              description={activeTabDefinition.description}
            >
              {activeTabDefinition.content}
            </SectionCard>
          </div>
        </div>
      ) : (
        <div
          style={{
            maxWidth: "960px",
            margin: "0 auto",
          }}
        >
          <SectionCard title="Welcome" description="Please choose a role-specific dashboard.">
            <p style={{ marginTop: "12px", fontSize: "14px", color: "#475569" }}>
              Switch to the teacher dashboard to view instructor tools.
            </p>
          </SectionCard>
        </div>
      )}
      <DashboardFooter />
    </main>
  );
}

function PaymentNotice() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [paymentBanner, setPaymentBanner] = useState(null);

  useEffect(() => {
    const paymentParam = searchParams?.get("payment");
    if (!paymentParam) return;

    const banner =
      paymentParam === "success"
        ? {
            tone: "success",
            title: "Payment successful",
            message: "Thank you! Your payment was received. Enrollment will show as paid shortly.",
          }
        : paymentParam === "cancelled"
        ? {
            tone: "warn",
            title: "Payment cancelled",
            message: "No charge was made. You can retry payment from the course page.",
          }
        : null;

    if (!banner) return;

    setPaymentBanner(banner);

    // Clear the query param so the banner only shows once.
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.delete("payment");
    router.replace(params.toString() ? `${pathname}?${params}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!paymentBanner) return undefined;
    const timer = setTimeout(() => setPaymentBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [paymentBanner]);

  if (!paymentBanner) return null;

  return (
    <SectionCard
      title={paymentBanner.title}
      description={paymentBanner.message}
      actions={[]}
    />
  );
}

function DashboardFooter() {
  const footerColumns = [
    {
      title: "Piano Studio",
      links: [
        { label: "About us", href: "/Dashboard" },
        { label: "Course catalog", href: "/Dashboard" },
        { label: "Practice log", href: "/practice-log" },
        { label: "Student payments", href: "/student/payments" },
      ],
    },
    {
      title: "Learning",
      links: [
        { label: "Courses", href: "/Dashboard" },
        { label: "Materials", href: "/Dashboard" },
        { label: "Attendance", href: "/Dashboard" },
        { label: "Progress", href: "/Dashboard" },
      ],
    },
    {
      title: "Support",
      links: [
        { label: "Contact teacher", href: "/teacher/dashboard" },
        { label: "Billing help", href: "/student/payments" },
        { label: "Privacy", href: "#" },
        { label: "Terms", href: "#" },
      ],
    },
  ];

  return (
    <footer
      style={{
        maxWidth: "1200px",
        margin: "32px auto 0",
        borderTop: "1px solid rgba(203,213,225,0.8)",
        paddingTop: "28px",
        display: "grid",
        gap: "24px",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "20px",
        }}
      >
        {footerColumns.map((column) => (
          <section key={column.title} style={{ display: "grid", gap: "8px" }}>
            <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#0f172a" }}>
              {column.title}
            </h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
              {column.links.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    style={{
                      color: "#334155",
                      fontSize: "14px",
                      textDecoration: "none",
                    }}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div
        style={{
          borderTop: "1px solid rgba(226,232,240,0.9)",
          paddingTop: "16px",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: "10px",
          color: "#64748b",
          fontSize: "13px",
        }}
      >
        <span>© 2026 Piano Studio. All rights reserved.</span>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <a href="https://www.facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook">
            <Image
              src="/facebook.png"
              alt="Facebook"
              width={22}
              height={22}
              style={{ display: "block" }}
            />
          </a>
          <a href="https://www.youtube.com" target="_blank" rel="noreferrer" aria-label="YouTube">
            <Image
              src="/Youtube.png"
              alt="YouTube"
              width={22}
              height={22}
              style={{ display: "block" }}
            />
          </a>
          <a href="https://www.instagram.com" target="_blank" rel="noreferrer" aria-label="Instagram">
            <Image
              src="/instagram.jpg"
              alt="Instagram"
              width={22}
              height={22}
              style={{ display: "block" }}
            />
          </a>
        </div>
      </div>
    </footer>
  );
}

function StudentStatsBar({ stats }) {
  if (!stats?.length) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "12px",
      }}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          style={{
            borderRadius: "18px",
            padding: "16px",
            border: "1px solid rgba(148,163,184,0.3)",
            backgroundColor: "rgba(15,23,42,0.04)",
            display: "grid",
            gap: "6px",
          }}
        >
          <span
            style={{
              fontSize: "12px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            {stat.label}
          </span>
          <strong style={{ fontSize: "22px", color: "#0f172a" }}>{stat.value ?? 0}</strong>
        </div>
      ))}
    </div>
  );
}

function StudentTabNav({ tabs, activeTab, onSelect }) {
  if (!tabs?.length) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "12px",
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect?.(tab.id)}
            style={{
              borderRadius: "18px",
              padding: "14px",
              border: isActive ? "2px solid #2563eb" : "1px solid rgba(148,163,184,0.5)",
              background: isActive
                ? "linear-gradient(120deg, #2563eb, #1d4ed8)"
                : "rgba(248,250,252,0.9)",
              color: isActive ? "white" : "#0f172a",
              textAlign: "left",
              display: "grid",
              gap: "6px",
              cursor: "pointer",
              transition: "transform 0.15s ease",
            }}
          >
            <span style={{ fontSize: "15px", fontWeight: 600 }}>{tab.label}</span>
            {tab.badge && (
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: isActive ? "rgba(255,255,255,0.85)" : "#475569",
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SectionCard({ title, description, actions, children }) {
  return (
    <section
      style={{
        borderRadius: "24px",
        border: "1px solid rgba(148,163,184,0.25)",
        backgroundColor: "rgba(248,250,252,0.95)",
        padding: "28px",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 600, color: "#0f172a" }}>{title}</h2>
          {description && (
            <p style={{ marginTop: "6px", color: "#475569", fontSize: "14px" }}>{description}</p>
          )}
        </div>
        {actions?.length ? (
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {actions.map((action) =>
              action.href ? (
                <Link
                  key={action.label}
                  href={action.href}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "10px",
                    border: "1px solid rgba(148,163,184,0.4)",
                    backgroundColor: "white",
                    color: "#0f172a",
                    fontSize: "13px",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  {action.label}
                </Link>
              ) : (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "10px",
                    border: "1px solid rgba(148,163,184,0.4)",
                    backgroundColor: "white",
                    color: "#0f172a",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {action.label}
                </button>
              )
            )}
          </div>
        ) : null}
      </div>
      {children && <div style={{ marginTop: "20px" }}>{children}</div>}
    </section>
  );
}

function StudentSidebar({
  sessionUser,
  primaryNav,
  quickLinks,
  activeTab,
  onSelectTab,
  onSignOut,
}) {
  const initials =
    sessionUser?.profileName
      ?.split(" ")
      .map((part) => part[0]?.toUpperCase())
      .slice(0, 2)
      .join("") ||
    sessionUser?.email?.slice(0, 2).toUpperCase() ||
    "ST";

  return (
    <aside
      style={{
        flex: "0 0 260px",
        minWidth: "260px",
        borderRadius: "28px",
        border: "1px solid rgba(226,232,240,0.6)",
        backgroundColor: "rgba(255,255,255,0.95)",
        boxShadow: "0 24px 50px rgba(15, 23, 42, 0.12)",
        padding: "28px",
        display: "grid",
        gap: "24px",
      }}
    >
      <div
        style={{
          borderRadius: "20px",
          padding: "16px",
          background:
            "linear-gradient(140deg, rgba(59,130,246,0.12), rgba(14,165,233,0.18))",
          display: "grid",
          gap: "12px",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "18px",
            backgroundColor: "rgba(255,255,255,0.95)",
            color: "#1d4ed8",
            fontWeight: 700,
            fontSize: "22px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {initials}
        </div>
        <div>
          <p style={{ fontSize: "14px", color: "#0f172a", fontWeight: 600 }}>
            {sessionUser?.profileName || sessionUser?.email}
          </p>
          <p style={{ fontSize: "12px", color: "#475569" }}>
            {roleLabels[sessionUser?.role] || "Student"}
          </p>
        </div>
      </div>

      <nav style={{ display: "grid", gap: "8px" }}>
        {primaryNav?.map((item) => {
          const isActive = item.id === activeTab;
          const navStyle = {
            width: "100%",
            borderRadius: "14px",
            border: isActive ? "2px solid #2563eb" : "1px solid rgba(226,232,240,0.8)",
            backgroundColor: isActive ? "rgba(59,130,246,0.08)" : "white",
            color: "#0f172a",
            textAlign: "left",
            padding: "12px",
            display: "grid",
            gap: "4px",
            cursor: "pointer",
          };
          if (item.href) {
            return (
              <Link key={item.id} href={item.href} style={navStyle}>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>
                  {item.icon} {item.label}
                </span>
                <span style={{ fontSize: "11px", color: "#64748b" }}>{item.description}</span>
              </Link>
            );
          }
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab?.(item.id)}
              style={navStyle}
            >
              <span style={{ fontSize: "13px", fontWeight: 600 }}>
                {item.icon} {item.label}
              </span>
              <span style={{ fontSize: "11px", color: "#64748b" }}>{item.description}</span>
            </button>
          );
        })}
      </nav>

      {quickLinks?.length ? (
        <div style={{ display: "grid", gap: "10px" }}>
          {quickLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                borderRadius: "14px",
                padding: "10px 12px",
                border: "1px solid rgba(148,163,184,0.4)",
                textDecoration: "none",
                color: "#0f172a",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              <span>{link.icon}</span>
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onSignOut}
        style={{
          marginTop: "auto",
          padding: "10px 16px",
          borderRadius: "12px",
          border: "none",
          background: "linear-gradient(120deg, #ef4444, #dc2626)",
          color: "white",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Log out
      </button>
    </aside>
  );
}

function StudentHero({
  sessionUser,
  upcomingLessons,
  pendingRequests,
  searchValue,
  onSearchInputChange,
  onExecuteSearch,
  onBrowseCourses,
}) {
  return (
    <section
      style={{
        borderRadius: "32px",
        padding: "32px",
        background:
          "linear-gradient(120deg, rgba(59,130,246,0.08), rgba(14,165,233,0.12), rgba(255,255,255,0.95))",
        display: "grid",
        gap: "20px",
        border: "1px solid rgba(226,232,240,0.6)",
        boxShadow: "0 24px 60px rgba(37, 99, 235, 0.15)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "18px" }}>
        <div style={{ flex: "1 1 420px", minWidth: "0" }}>
          <p
            style={{
              display: "inline-flex",
              padding: "6px 16px",
              borderRadius: "999px",
              backgroundColor: "rgba(59,130,246,0.12)",
              color: "#1d4ed8",
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "0.18em",
            }}
          >
            STUDENT DASHBOARD
          </p>
          <h1
            style={{
              marginTop: "16px",
              fontSize: "30px",
              fontWeight: 700,
              color: "#0f172a",
            }}
          >
            Welcome back {sessionUser?.profileName || sessionUser?.email}! Continue your music journey.
          </h1>
          <p style={{ marginTop: "8px", color: "#475569", fontSize: "14px" }}>
            {upcomingLessons
              ? `You have ${upcomingLessons} upcoming lesson${upcomingLessons > 1 ? "s" : ""}.`
              : "No sessions scheduled yet. Reach out to your instructor to plan the next lesson."}{" "}
            {pendingRequests
              ? `${pendingRequests} reschedule request${pendingRequests > 1 ? "s" : ""} in review.`
              : ""}
          </p>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          alignItems: "center",
        }}
      >
        <div
          style={{
            flex: "1 1 260px",
            minWidth: "0",
            display: "flex",
            alignItems: "center",
            borderRadius: "16px",
            backgroundColor: "rgba(255,255,255,0.9)",
            border: "1px solid rgba(148,163,184,0.35)",
            padding: "10px 12px",
            gap: "8px",
            boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
          }}
        >
          <span role="img" aria-hidden="true">
            🔍
          </span>
          <input
            type="text"
            placeholder="Search courses or materials..."
            value={searchValue}
            onChange={(event) => onSearchInputChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onExecuteSearch?.();
              }
            }}
            style={{
              border: "none",
              outline: "none",
              flex: 1,
              fontSize: "14px",
              backgroundColor: "transparent",
              color: "#0f172a",
            }}
          />
        </div>
        <button
          type="button"
          onClick={onExecuteSearch}
          style={{
            padding: "12px 20px",
            borderRadius: "16px",
            border: "none",
            background: "linear-gradient(120deg, #2563eb, #1d4ed8)",
            color: "white",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 12px 30px rgba(37,99,235,0.25)",
          }}
        >
          Search
        </button>
        <button
          type="button"
          onClick={onBrowseCourses}
          style={{
            padding: "12px 20px",
            borderRadius: "16px",
            border: "1px solid rgba(148,163,184,0.5)",
            backgroundColor: "white",
            color: "#0f172a",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Browse catalog
        </button>
        <Link
          href="/practice-log"
          style={{
            padding: "12px 20px",
            borderRadius: "16px",
            border: "1px solid rgba(148,163,184,0.5)",
            backgroundColor: "white",
            color: "#0f172a",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Practice log
        </Link>
      </div>
    </section>
  );
}

function StudentCourses({ courses, enrollmentById, searchActive }) {
  if (!courses?.length) {
    return (
      <p style={{ marginTop: "14px", fontSize: "13px", color: "#475569" }}>
        {searchActive
          ? "No courses match your search. Try another keyword."
          : "No courses available at the moment."}
      </p>
    );
  }

  return (
      <div style={{ marginTop: "18px", display: "grid", gap: "18px" }}>
        {courses.map((course) => {
          const enrollment = enrollmentById.get(course.id);
          const isEnrolled = Boolean(enrollment);
          const isPaid = hasPaidAccess(enrollment);
          const statusLabel = enrollment?.status ?? (isEnrolled ? "Enrolled" : null);
          const studentLabel = enrollment?.studentName ?? null;
          const timeLabel = enrollment?.timeSlotLabel ?? "";
          const quizScore =
            typeof enrollment?.quizScore === "number" ? `Latest quiz: ${enrollment.quizScore}%` : null;
          const quizLockedLabel = isEnrolled
            ? "Complete payment to unlock quiz"
            : "Enroll to unlock quiz";

        const details = [];
        if (statusLabel) details.push(statusLabel);
        if (studentLabel) details.push(`Student: ${studentLabel}`);
        if (timeLabel) details.push(`Preferred time: ${timeLabel}`);
        if (quizScore) details.push(quizScore);

        const summarySource = course.headline || course.description || "";
        const summary =
          summarySource.length > 180
            ? `${summarySource.slice(0, 177)}…`
            : summarySource;

        return (
          <article
            key={course.id}
            style={{
              borderRadius: "16px",
              background: "white",
              border: "1px solid rgba(209,213,223,0.6)",
              padding: "18px",
              boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
              display: "flex",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <Link
              href={`/courses/${course.id}`}
              style={{
                flex: "0 0 260px",
                minWidth: "220px",
                borderRadius: "14px",
                overflow: "hidden",
                height: "140px",
                backgroundColor: "#cbd5f5",
                display: "block",
              }}
            >
              {course.imageUrl ? (
                <img
                  src={course.imageUrl}
                  alt={course.title}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : null}
            </Link>
            <div
              style={{
                flex: "1 1 280px",
                minWidth: "0",
                display: "grid",
                gap: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "14px",
                }}
              >
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#0f172a" }}>{course.title}</h3>
                  <p style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>
                    Teacher: {course.teacher}
                  </p>
                </div>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 14px",
                    height: "26px",
                    borderRadius: "999px",
                    fontSize: "12px",
                    fontWeight: 600,
                    backgroundColor: "#e0f2fe",
                    color: "#0369a1",
                    whiteSpace: "nowrap",
                  }}
                >
                  {course.level}
                </span>
              </div>

              {summary && <p style={{ fontSize: "13px", color: "#334155", margin: 0 }}>{summary}</p>}

              <div style={{ fontSize: "12px", color: "#475569" }}>
                <span style={{ marginRight: "12px" }}>Duration: {course.duration}</span>
                <span>Tuition: ${course.tuition}</span>
              </div>

              {details.length > 0 && (
                <div style={{ fontSize: "12px", color: "#0369a1", fontWeight: 600 }}>
                  {details.join(" | ")}
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                <Link
                  href={`/courses/${course.id}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "10px 18px",
                    borderRadius: "10px",
                    background: "linear-gradient(120deg, #2563eb, #1d4ed8)",
                    color: "white",
                    fontWeight: 600,
                    textDecoration: "none",
                    boxShadow: "0 12px 30px rgba(37, 99, 235, 0.28)",
                  }}
                >
                  {isEnrolled ? "Manage Enrollment" : "View Details"}
                </Link>

                {course.quiz && isPaid && (
                  <Link
                    href={`/courses/${course.id}/quiz`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "10px 18px",
                      borderRadius: "10px",
                      backgroundColor: "#0f172a",
                      color: "white",
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    {enrollment?.quizScore ? "Retake Quiz" : "Take Quiz"}
                  </Link>
                )}

                {course.quiz && !isPaid && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 14px",
                      borderRadius: "999px",
                      backgroundColor: "#fef2f2",
                      color: "#b91c1c",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}
                  >
                    {"\uD83D\uDD12"} {quizLockedLabel}
                  </span>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function StudentAttendance({
  enrolledCourses,
  lessonSessions,
  attendanceRecords,
  studentEmail,
  rescheduleRequests,
  onSubmitReschedule,
  submittingRequestId,
  showPast,
  onToggleShowPast,
}) {
  const [activeRequestKey, setActiveRequestKey] = useState(null);
  const [requestDate, setRequestDate] = useState('');
  const [requestTime, setRequestTime] = useState('');
  const [requestMessage, setRequestMessage] = useState('');

  const metaChipBaseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.01em',
  };

  const hasEnrollments = enrolledCourses.length > 0;
  const courseMap = new Map(enrolledCourses.map((course) => [course.id, course]));
  const courseIds = new Set(enrolledCourses.map((course) => course.id));
  const PAST_LIMIT_DAYS = 7;
  const PAST_EXTENDED_DAYS = 90;
  const now = Date.now();
  const pastLimit = now - (showPast ? PAST_EXTENDED_DAYS : PAST_LIMIT_DAYS) * 24 * 60 * 60 * 1000;
  const enrollmentActiveFromByCourse = useMemo(() => {
    const map = new Map();
    for (const course of enrolledCourses || []) {
      const enrollment = course?.enrollment || {};
      const slotActivatedMs = toMillis(enrollment.slotActivatedAt);
      if (Number.isFinite(slotActivatedMs) && slotActivatedMs > 0) {
        map.set(course.id, slotActivatedMs);
        continue;
      }

      const cancelledMs = toMillis(enrollment.cancelledAt);
      const enrolledMs = toMillis(enrollment.enrolledAt);
      const paidMs = toMillis(enrollment.paidAt);
      const updatedMs = toMillis(enrollment.updatedAt);

      let activeFromMs = Math.max(
        Number.isFinite(enrolledMs) ? enrolledMs : 0,
        Number.isFinite(paidMs) ? paidMs : 0
      );
      if (
        Number.isFinite(updatedMs) &&
        Number.isFinite(cancelledMs) &&
        updatedMs > cancelledMs
      ) {
        activeFromMs = Math.max(activeFromMs, updatedMs);
      }

      map.set(course.id, activeFromMs > 0 ? activeFromMs : 0);
    }
    return map;
  }, [enrolledCourses]);

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

  const enrollmentSlotCriteriaByCourse = useMemo(() => {
    const map = new Map();
    for (const course of enrolledCourses || []) {
      const enrollment = course?.enrollment || {};
      const dayLabel = String(enrollment.timeSlotDay || "").trim();
      const fromStoredDays = normalizeEnrollmentWeekdays(enrollment.timeSlotDays);
      const dayIndexes = fromStoredDays.length ? fromStoredDays : parseWeekdayIndexes(dayLabel);
      map.set(course.id, {
        dayIndexes,
        startTime: String(enrollment.timeSlotStartTime || "").trim(),
        endTime: String(enrollment.timeSlotEndTime || "").trim(),
      });
    }
    return map;
  }, [enrolledCourses]);

  function sessionMatchesSlotCriteria(session, criteria) {
    if (!criteria) return true;
    const expectedStart = criteria.startTime || "";
    const expectedEnd = criteria.endTime || "";
    const expectedDays = Array.isArray(criteria.dayIndexes) ? criteria.dayIndexes : [];
    const sessionStart = String(session?.startTime || "").trim();
    const sessionEnd = String(session?.endTime || "").trim();

    if (expectedStart && sessionStart && sessionStart !== expectedStart) return false;
    if (expectedEnd && sessionEnd && sessionEnd !== expectedEnd) return false;
    if (!expectedDays.length || !session?.date) return true;

    const sessionTime = new Date(`${session.date}T${session.startTime || "00:00"}`).getTime();
    if (Number.isNaN(sessionTime)) return true;
    const sessionDay = new Date(sessionTime).getDay();
    return expectedDays.includes(sessionDay);
  }

  const activeAttendanceRecords = useMemo(() => {
    return (attendanceRecords || []).filter((record) => {
      const courseId = String(record?.courseId || "").trim();
      if (!courseId) return true;
      const activeFrom = enrollmentActiveFromByCourse.get(courseId) || 0;
      if (!activeFrom) return true;
      const markedMs = toMillis(record?.markedAt);
      if (!Number.isFinite(markedMs)) return true;
      return markedMs >= activeFrom - 60 * 1000;
    });
  }, [attendanceRecords, enrollmentActiveFromByCourse]);

  const activeRescheduleRequests = useMemo(() => {
    return (rescheduleRequests || []).filter((request) => {
      const courseId = String(request?.courseId || "").trim();
      if (!courseId) return true;
      const activeFrom = enrollmentActiveFromByCourse.get(courseId) || 0;
      if (!activeFrom) return true;
      const createdMs = toMillis(request?.createdAt);
      if (!Number.isFinite(createdMs)) return true;
      return createdMs >= activeFrom - 60 * 1000;
    });
  }, [rescheduleRequests, enrollmentActiveFromByCourse]);

  const attendanceSessionIds = useMemo(() => {
    const set = new Set();
    for (const record of activeAttendanceRecords || []) {
      if (record?.sessionId) set.add(record.sessionId);
    }
    return set;
  }, [activeAttendanceRecords]);

  const approvedRequestSessionIds = useMemo(() => {
    const set = new Set();
    for (const request of activeRescheduleRequests || []) {
      const status = String(request?.status || "").toLowerCase();
      if (status !== "approved") continue;
      if (request?.sessionId) set.add(request.sessionId);
    }
    return set;
  }, [activeRescheduleRequests]);

  const approvedRequestDateKeysByCourse = useMemo(() => {
    const map = new Map();
    for (const request of activeRescheduleRequests || []) {
      const status = String(request?.status || "").toLowerCase();
      if (status !== "approved") continue;
      const courseId = request?.courseId;
      if (!courseId) continue;
      const dateValue = (request?.approvedDate || request?.requestedDate || "").trim();
      if (!dateValue) continue;
      const timeValue = (request?.approvedTime || request?.requestedTime || "").trim();
      const key = `${dateValue}|${timeValue}`;
      if (!map.has(courseId)) {
        map.set(courseId, new Set());
      }
      map.get(courseId).add(key);
      if (!timeValue) {
        map.get(courseId).add(`${dateValue}|`);
      }
    }
    return map;
  }, [activeRescheduleRequests]);

  function sessionMatchesApprovedRequest(session) {
    if (!session?.id || !session?.courseId || !session?.date) return false;
    if (approvedRequestSessionIds.has(session.id)) return true;
    const keys = approvedRequestDateKeysByCourse.get(session.courseId);
    if (!keys || !keys.size) return false;
    const startTime = String(session.startTime || "").trim();
    return keys.has(`${session.date}|${startTime}`) || keys.has(`${session.date}|`);
  }

  function getSessionDedupKey(session) {
    if (!session) return "";
    const courseId = String(session.courseId || "").trim();
    const date = String(session.date || "").trim();
    const startTime = String(session.startTime || "").trim();
    if (courseId && date && startTime) {
      return `${courseId}|${date}|${startTime}`;
    }
    return String(session.id || "");
  }

  function getSessionDisplayScore(session) {
    if (!session) return -1;
    let score = 0;
    if (attendanceSessionIds.has(session.id)) score += 100;
    if (sessionMatchesApprovedRequest(session)) score += 70;
    if (String(session.source || "").toLowerCase() !== "fixed_weekly_slot") score += 20;
    if ((session.meetingUrl || session.location || "").trim()) score += 10;
    return score;
  }

  function choosePreferredSession(current, next) {
    if (!current) return next;
    const currentScore = getSessionDisplayScore(current);
    const nextScore = getSessionDisplayScore(next);
    if (nextScore !== currentScore) {
      return nextScore > currentScore ? next : current;
    }

    const currentCreatedMs = toMillis(current?.createdAt);
    const nextCreatedMs = toMillis(next?.createdAt);
    if (Number.isFinite(currentCreatedMs) && Number.isFinite(nextCreatedMs) && nextCreatedMs !== currentCreatedMs) {
      return nextCreatedMs > currentCreatedMs ? next : current;
    }
    if (Number.isFinite(nextCreatedMs) && !Number.isFinite(currentCreatedMs)) {
      return next;
    }
    return current;
  }

  const filteredSessions = (lessonSessions || []).filter((session) => {
      if (!courseIds.has(session.courseId)) return false;
      if (session.archived) return false;
      if (!session?.date) return true;
      const sessionTime = new Date(`${session.date}T${session.startTime || "00:00"}`).getTime();
      if (Number.isNaN(sessionTime)) return true;
      const enrollmentActiveFrom = enrollmentActiveFromByCourse.get(session.courseId) || 0;
      if (enrollmentActiveFrom && sessionTime < enrollmentActiveFrom - 60 * 1000) return false;
      const criteria = enrollmentSlotCriteriaByCourse.get(session.courseId);
      const slotMatched = sessionMatchesSlotCriteria(session, criteria);
      const approvedMatched = sessionMatchesApprovedRequest(session);
      const attendanceMatched = attendanceSessionIds.has(session.id);
      if (sessionTime >= now && !slotMatched && !approvedMatched && !attendanceMatched) return false;
      return sessionTime >= pastLimit;
    });

  const relevantSessionMap = new Map();
  for (const session of filteredSessions) {
    const dedupKey = getSessionDedupKey(session);
    const existing = relevantSessionMap.get(dedupKey);
    relevantSessionMap.set(dedupKey, choosePreferredSession(existing, session));
  }

  const relevantSessions = Array.from(relevantSessionMap.values()).sort((a, b) => {
    const dateA = new Date((a.date || '') + 'T' + (a.startTime || '00:00'));
    const dateB = new Date((b.date || '') + 'T' + (b.startTime || '00:00'));
    return dateB.getTime() - dateA.getTime();
  });

  const attendanceMap = new Map();
  for (const record of activeAttendanceRecords || []) {
    if (record?.sessionId) {
      attendanceMap.set(record.sessionId, record);
    }
  }

  function choosePreferredRequest(current, next) {
    if (!current) return next;
    const currentStatus = (current?.status || "pending").toLowerCase();
    const nextStatus = (next?.status || "pending").toLowerCase();
    const currentPending = currentStatus === "pending";
    const nextPending = nextStatus === "pending";
    if (currentPending !== nextPending) {
      return nextPending ? next : current;
    }

    const currentMs = toMillis(current?.createdAt);
    const nextMs = toMillis(next?.createdAt);
    if (Number.isFinite(currentMs) && Number.isFinite(nextMs) && nextMs !== currentMs) {
      return nextMs > currentMs ? next : current;
    }
    if (Number.isFinite(nextMs) && !Number.isFinite(currentMs)) {
      return next;
    }
    return current;
  }

  const requestsBySession = useMemo(() => {
    const map = new Map();
    for (const request of activeRescheduleRequests || []) {
      if (!request?.sessionId) continue;
      const existing = map.get(request.sessionId);
      map.set(request.sessionId, choosePreferredRequest(existing, request));
    }
    return map;
  }, [activeRescheduleRequests]);

  const requestsByCourse = useMemo(() => {
    const map = new Map();
    for (const request of activeRescheduleRequests || []) {
      if (!request?.courseId) continue;
      const existing = map.get(request.courseId);
      map.set(request.courseId, choosePreferredRequest(existing, request));
    }
    return map;
  }, [activeRescheduleRequests]);

  const meetingLinkByCourse = useMemo(() => {
    const upcoming = [];
    const past = [];
    const nowTime = Date.now();

    for (const session of lessonSessions || []) {
      if (!session?.courseId) continue;
      const rawLink = (session.meetingUrl || session.location || "").trim();
      if (!rawLink) continue;
      const sessionTime = session.date
        ? new Date(`${session.date}T${session.startTime || "00:00"}`).getTime()
        : NaN;
      const entry = { courseId: session.courseId, link: rawLink, time: sessionTime };
      if (Number.isNaN(sessionTime) || sessionTime >= nowTime) {
        upcoming.push(entry);
      } else {
        past.push(entry);
      }
    }

    upcoming.sort((a, b) => a.time - b.time);
    past.sort((a, b) => b.time - a.time);

    const map = new Map();
    for (const item of upcoming) {
      if (!map.has(item.courseId)) {
        map.set(item.courseId, item.link);
      }
    }
    for (const item of past) {
      if (!map.has(item.courseId)) {
        map.set(item.courseId, item.link);
      }
    }
    return map;
  }, [lessonSessions]);

  const statusStyles = {
    pending: { label: 'Pending', color: '#a855f7', background: '#f3e8ff' },
    present: { label: 'Present', color: '#15803d', background: '#dcfce7' },
    absent: { label: 'Absent', color: '#b91c1c', background: '#fee2e2' },
    excused: { label: 'Excused', color: '#0369a1', background: '#e0f2fe' },
  };

  const requestStatusStyles = {
    pending: { label: 'Pending', color: '#a855f7', background: '#f3e8ff' },
    approved: { label: 'Approved', color: '#15803d', background: '#dcfce7' },
    rejected: { label: 'Declined', color: '#b91c1c', background: '#fee2e2' },
  };

  function parseWeekdayIndexes(dayLabel) {
    const normalized = (dayLabel || "").toLowerCase();
    if (!normalized) return [];
    const indices = new Set();
    const tokens = [
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

    if (normalized.includes("weekday")) {
      [1, 2, 3, 4, 5].forEach((value) => indices.add(value));
    }
    if (normalized.includes("weekend")) {
      [0, 6].forEach((value) => indices.add(value));
    }
    for (const [token, index] of tokens) {
      if (normalized.includes(token)) {
        indices.add(index);
      }
    }
    return Array.from(indices);
  }

  function getNextFixedSlotDate(dayLabel, startTime) {
    const weekdays = parseWeekdayIndexes(dayLabel);
    if (!weekdays.length || !startTime) return null;

    const nowTime = Date.now();
    const baseDate = new Date();
    baseDate.setHours(0, 0, 0, 0);
    const [hourPart, minutePart] = String(startTime || "00:00")
      .split(":")
      .map((value) => Number.parseInt(value, 10));
    const hour = Number.isFinite(hourPart) ? hourPart : 0;
    const minute = Number.isFinite(minutePart) ? minutePart : 0;

    for (let offset = 0; offset < 14; offset += 1) {
      const candidate = new Date(baseDate);
      candidate.setDate(baseDate.getDate() + offset);
      if (!weekdays.includes(candidate.getDay())) continue;
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getTime() < nowTime - 60 * 1000) continue;
      return candidate;
    }
    return null;
  }

  function formatRelativeTime(targetDate) {
    if (!targetDate) return '';
    const diffMs = targetDate.getTime() - Date.now();
    const absMs = Math.abs(diffMs);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (absMs < hour) {
      const minutes = Math.max(1, Math.round(absMs / minute));
      return diffMs >= 0 ? `in ${minutes} min` : `${minutes} min ago`;
    }

    if (absMs < day) {
      const hours = Math.max(1, Math.round(absMs / hour));
      const plural = hours > 1 ? 's' : '';
      return diffMs >= 0 ? `in ${hours} hr${plural}` : `${hours} hr${plural} ago`;
    }

    const days = Math.max(1, Math.round(absMs / day));
    return diffMs >= 0 ? `in ${days} day${days > 1 ? 's' : ''}` : `${days} day${days > 1 ? 's' : ''} ago`;
  }

  function formatSessionDateTime(session) {
    if (!session?.date) return "Date TBA";
    const computed = new Date(`${session.date}T${session.startTime || "00:00"}`);
    if (Number.isNaN(computed.getTime())) return "Date TBA";
    return computed.toLocaleString();
  }

  function toDateInputValue(dateValue) {
    if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return "";
    const year = dateValue.getFullYear();
    const month = String(dateValue.getMonth() + 1).padStart(2, "0");
    const day = String(dateValue.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getSlotRequestKey(slot) {
    if (!slot) return "";
    return slot.requestTargetSession?.id || `course:${slot.id}`;
  }

  function openRequestForm(slot) {
    const targetSession = slot?.requestTargetSession;
    const requestKey = getSlotRequestKey(slot);
    if (!requestKey) return;
    const preferredDate =
      slot?.nextSession?.date ||
      slot?.estimatedNextLessonDateValue ||
      targetSession?.date ||
      "";
    const preferredTime =
      slot?.nextSession?.startTime ||
      slot?.preferredStartTime ||
      targetSession?.startTime ||
      "";

    setActiveRequestKey(requestKey);
    setRequestDate(preferredDate);
    setRequestTime(preferredTime);
    setRequestMessage('');
  }

  async function handleSubmitRequest(event, slot) {
    event.preventDefault();
    if (!slot) return;
    if (!requestDate.trim()) {
      alert('Please choose a preferred make-up date.');
      return;
    }

    await onSubmitReschedule?.(
      {
        requestSubmitKey: getSlotRequestKey(slot),
        requestTargetSession: slot.requestTargetSession || null,
        courseId: slot.id,
        courseTitle: slot.title,
        teacherUid: slot.teacherUid || "",
        teacherEmail: slot.teacherEmail || "",
      },
      {
      requestedDate: requestDate,
      requestedTime: requestTime,
      message: requestMessage,
      }
    );
    setActiveRequestKey(null);
    setRequestMessage('');
  }

  if (!hasEnrollments) {
    return (
      <p style={{ marginTop: '14px', fontSize: '13px', color: '#475569' }}>
        Enroll in a course to see your attendance history.
      </p>
    );
  }

  const weeklySlots = enrolledCourses.map((course) => {
    const enrollment = course.enrollment || {};
    const isPaid = hasPaidAccess(enrollment);
    const dayLabel = (enrollment.timeSlotDay || "").trim();
    const startTime = (enrollment.timeSlotStartTime || "").trim();
    const endTime = (enrollment.timeSlotEndTime || "").trim();
    const slotLabel =
      dayLabel && startTime && endTime
        ? `${dayLabel} ${startTime} - ${endTime}`
        : enrollment.timeSlotLabel || "Schedule pending";
    const slotCriteria =
      enrollmentSlotCriteriaByCourse.get(course.id) || {
        dayIndexes: parseWeekdayIndexes(dayLabel),
        startTime,
        endTime,
      };
    let nextSession = null;
    let nextSessionTime = Number.POSITIVE_INFINITY;
    let latestSession = null;
    let latestSessionTime = Number.NEGATIVE_INFINITY;
    let undatedSession = null;
    let fallbackLatestSession = null;
    let fallbackLatestSessionTime = Number.NEGATIVE_INFINITY;
    let fallbackUndatedSession = null;
    const enrollmentActiveFrom = enrollmentActiveFromByCourse.get(course.id) || 0;
    for (const session of lessonSessions || []) {
      if (session?.courseId !== course.id || session?.archived) continue;
      const createdAtMs = toMillis(session?.createdAt);
      const sessionHasDate = Boolean(session?.date);
      let sessionTime = Number.NaN;
      if (sessionHasDate) {
        sessionTime = new Date(`${session.date}T${session.startTime || "00:00"}`).getTime();
      }
      const isAfterEnrollmentActivation = !enrollmentActiveFrom
        ? true
        : sessionHasDate
        ? Number.isFinite(sessionTime) && sessionTime >= enrollmentActiveFrom - 60 * 1000
        : !Number.isFinite(createdAtMs) || createdAtMs >= enrollmentActiveFrom - 60 * 1000;

      if (isAfterEnrollmentActivation) {
        if (!sessionHasDate) {
          if (!fallbackUndatedSession) fallbackUndatedSession = session;
        } else if (Number.isFinite(sessionTime) && sessionTime > fallbackLatestSessionTime) {
          fallbackLatestSession = session;
          fallbackLatestSessionTime = sessionTime;
        }
      }

      const slotMatched = sessionMatchesSlotCriteria(session, slotCriteria);
      const approvedMatched = sessionMatchesApprovedRequest(session);
      const attendanceMatched = attendanceSessionIds.has(session.id);
      if (!slotMatched && !approvedMatched && !attendanceMatched) continue;
      if (!session?.date) {
        if (!fallbackUndatedSession && isAfterEnrollmentActivation) fallbackUndatedSession = session;
      } else {
        if (
          isAfterEnrollmentActivation &&
          Number.isFinite(sessionTime) &&
          sessionTime > fallbackLatestSessionTime
        ) {
          fallbackLatestSession = session;
          fallbackLatestSessionTime = sessionTime;
        }
      }

      if (!session?.date) {
        if (
          !undatedSession &&
          (!enrollmentActiveFrom || !Number.isFinite(createdAtMs) || createdAtMs >= enrollmentActiveFrom - 60 * 1000)
        ) {
          undatedSession = session;
        }
        continue;
      }
      if (Number.isNaN(sessionTime)) continue;
      if (enrollmentActiveFrom && sessionTime < enrollmentActiveFrom - 60 * 1000) continue;
      if (sessionTime >= now && sessionTime < nextSessionTime) {
        nextSession = session;
        nextSessionTime = sessionTime;
      }
      if (sessionTime > latestSessionTime) {
        latestSession = session;
        latestSessionTime = sessionTime;
      }
    }
    const requestTargetSession =
      nextSession ||
      latestSession ||
      undatedSession ||
      fallbackLatestSession ||
      fallbackUndatedSession ||
      null;
    const sessionLinkedRequest = requestTargetSession
      ? requestsBySession.get(requestTargetSession.id)
      : null;
    const fallbackCourseRequest = requestsByCourse.get(course.id) || null;
    const fallbackStatus = (fallbackCourseRequest?.status || "").toLowerCase();
    const linkedRequest =
      sessionLinkedRequest ||
      (fallbackCourseRequest && fallbackStatus === "pending" ? fallbackCourseRequest : null);
    const linkedRequestStatus = (linkedRequest?.status || "").toLowerCase();
    const canRequestReschedule =
      !linkedRequest || linkedRequestStatus === "rejected";
    const linkedRequestStyle =
      linkedRequest && requestStatusStyles[linkedRequest.status || "pending"];
    const sessionMeetingLink =
      (nextSession?.meetingUrl ||
        nextSession?.location ||
        requestTargetSession?.meetingUrl ||
        requestTargetSession?.location ||
        "").trim();
    const meetingLink =
      sessionMeetingLink ||
      (enrollment.meetingLink || "").trim() ||
      meetingLinkByCourse.get(course.id) ||
      "";
    const joinDisabledReason = !isPaid
      ? "Complete payment to join this class."
      : meetingLink
      ? ""
      : "Meeting link pending from instructor.";
    const estimatedNextLesson = nextSession ? null : getNextFixedSlotDate(dayLabel, startTime);
    const estimatedNextLessonDateValue = estimatedNextLesson ? toDateInputValue(estimatedNextLesson) : "";
    const nextSessionLabel = nextSession
      ? formatSessionDateTime(nextSession)
      : estimatedNextLesson
      ? `${estimatedNextLesson.toLocaleString()} (fixed slot estimate)`
      : "";
    return {
      id: course.id,
      title: course.title,
      teacher: course.teacher,
      slotLabel,
      nextSession,
      nextSessionLabel,
      requestTargetSession,
      requestSubmitKey: requestTargetSession?.id || `course:${course.id}`,
      linkedRequest,
      linkedRequestStatus,
      canRequestReschedule,
      linkedRequestStyle,
      meetingLink,
      isPaid,
      joinDisabledReason,
      preferredStartTime: startTime,
      estimatedNextLessonDateValue,
      teacherUid: enrollment.teacherUid || "",
      teacherEmail: enrollment.teacherEmail || "",
    };
  });

  return (
    <div style={{ marginTop: '18px', display: 'grid', gap: '16px' }}>
      <section
        style={{
          borderRadius: "18px",
          border: "1px solid rgba(226,232,240,0.7)",
          padding: "18px",
          backgroundColor: "white",
          boxShadow: "0 12px 30px rgba(15,23,42,0.04)",
          display: "grid",
          gap: "14px",
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#0f172a" }}>
            Weekly class schedule
          </h3>
          <p style={{ marginTop: "6px", fontSize: "12px", color: "#64748b" }}>
            Your fixed weekly slot. Reschedule details only appear after you submit a request.
          </p>
        </div>
        <div style={{ display: "grid", gap: "12px" }}>
          {weeklySlots.map((slot) => (
            <div
              key={slot.id}
              style={{
                borderRadius: "14px",
                border: "1px solid rgba(226,232,240,0.9)",
                padding: "14px",
                display: "grid",
                gap: "10px",
                backgroundColor: "#f8fafc",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>
                    {slot.title}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#475569" }}>
                    {slot.teacher ? `Instructor: ${slot.teacher}` : "Instructor pending"}
                  </p>
                  {slot.nextSessionLabel && (
                    <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>
                      Next lesson: {slot.nextSessionLabel}
                    </p>
                  )}
                </div>
                <div style={{ display: "grid", gap: "14px", justifyItems: "end" }}>
                  <span
                    style={{
                      padding: "4px 12px",
                      borderRadius: "999px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: "rgba(59,130,246,0.12)",
                      color: "#1d4ed8",
                    }}
                  >
                    {slot.slotLabel}
                  </span>
                  {slot.canRequestReschedule ? (
                    <button
                      type="button"
                      onClick={() => openRequestForm(slot)}
                      style={{
                        marginTop: "2px",
                        padding: "8px 14px",
                        borderRadius: "999px",
                        border: "1px solid rgba(14,165,233,0.4)",
                        backgroundColor: "white",
                        color: "#0369a1",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        boxShadow: "0 6px 12px rgba(14,165,233,0.12)",
                      }}
                    >
                      Request reschedule
                    </button>
                  ) : null}
                </div>
              </div>

              {!slot.requestTargetSession && (
                <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>
                  No lesson session has been published yet. You can still submit a request and your teacher will be notified.
                </p>
              )}

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                {slot.meetingLink && slot.isPaid ? (
                  <a
                    href={slot.meetingLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "8px 14px",
                      borderRadius: "999px",
                      border: "1px solid rgba(37,99,235,0.4)",
                      backgroundColor: "rgba(37,99,235,0.12)",
                      color: "#1d4ed8",
                      textDecoration: "none",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}
                  >
                    Join class
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    style={{
                      padding: "8px 14px",
                      borderRadius: "999px",
                      border: "1px solid rgba(148,163,184,0.5)",
                      backgroundColor: "rgba(226,232,240,0.7)",
                      color: "#94a3b8",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "not-allowed",
                    }}
                  >
                    Join class
                  </button>
                )}
                {slot.joinDisabledReason ? (
                  <span style={{ fontSize: "12px", color: "#b91c1c", fontWeight: 600 }}>
                    {slot.joinDisabledReason}
                  </span>
                ) : (
                  <span style={{ fontSize: "12px", color: "#64748b" }}>Link ready</span>
                )}

              </div>

              {slot.linkedRequest && (
                <div
                  style={{
                    borderRadius: "12px",
                    padding: "10px 12px",
                    backgroundColor:
                      (slot.linkedRequestStyle && slot.linkedRequestStyle.background) ||
                      "rgba(233,233,233,0.4)",
                    color: (slot.linkedRequestStyle && slot.linkedRequestStyle.color) || "#475569",
                    fontSize: "12px",
                    lineHeight: 1.5,
                  }}
                >
                  {(() => {
                    const requestStatus = (slot.linkedRequest.status || "pending").toLowerCase();
                    const displayDate =
                      requestStatus === "approved"
                        ? slot.linkedRequest.approvedDate || slot.linkedRequest.requestedDate
                        : slot.linkedRequest.requestedDate;
                    const displayTime =
                      requestStatus === "approved"
                        ? slot.linkedRequest.approvedTime || slot.linkedRequest.requestedTime
                        : slot.linkedRequest.requestedTime;
                    return (
                      <>
                  <strong style={{ fontWeight: 600 }}>
                    Reschedule {(slot.linkedRequestStyle && slot.linkedRequestStyle.label) || slot.linkedRequest.status}:
                  </strong>{" "}
                  {displayDate || "Date pending"}
                  {displayTime ? ` ${displayTime}` : ""}
                  {slot.linkedRequest.resolutionNote
                    ? ` · Instructor note: ${slot.linkedRequest.resolutionNote}`
                    : ""}
                      </>
                    );
                  })()}
                </div>
              )}

              {activeRequestKey === slot.requestSubmitKey &&
                slot.canRequestReschedule && (
                <div
                  style={{
                    borderRadius: "14px",
                    border: "1px solid rgba(148,163,184,0.3)",
                    backgroundColor: "rgba(224,242,254,0.35)",
                    padding: "14px",
                  }}
                >
                  <form onSubmit={(event) => handleSubmitRequest(event, slot)} style={{ display: "grid", gap: "10px" }}>
                    <div
                      style={{
                        display: "grid",
                        gap: "10px",
                        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      }}
                    >
                      <label style={{ display: "grid", gap: "6px", fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>
                        Preferred date
                        <input
                          type="date"
                          value={requestDate}
                          onChange={(event) => setRequestDate(event.target.value)}
                          style={{
                            padding: "10px 12px",
                            borderRadius: "10px",
                            border: "1px solid rgba(31,41,55,0.3)",
                            backgroundColor: "white",
                            color: "#0f172a",
                            fontSize: "13px",
                            width: "100%",
                          }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: "6px", fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>
                        Preferred time
                        <input
                          type="time"
                          value={requestTime}
                          onChange={(event) => setRequestTime(event.target.value)}
                          style={{
                            padding: "10px 12px",
                            borderRadius: "10px",
                            border: "1px solid rgba(31,41,55,0.3)",
                            backgroundColor: "white",
                            color: "#0f172a",
                            fontSize: "13px",
                            width: "100%",
                          }}
                        />
                      </label>
                    </div>

                    <label style={{ display: "grid", gap: "6px", fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>
                      Reason / details
                      <textarea
                        rows={3}
                        value={requestMessage}
                        onChange={(event) => setRequestMessage(event.target.value)}
                        placeholder="Briefly describe why you need to reschedule."
                        style={{
                          padding: "12px",
                          borderRadius: "10px",
                          border: "1px solid rgba(148,163,184,0.4)",
                          backgroundColor: "white",
                          color: "#0f172a",
                          fontSize: "13px",
                          resize: "vertical",
                        }}
                      />
                    </label>

                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                      <button
                        type="submit"
                        disabled={submittingRequestId === slot.requestSubmitKey}
                        style={{
                          padding: "9px 16px",
                          borderRadius: "10px",
                          border: "none",
                          background: submittingRequestId === slot.requestSubmitKey
                            ? "#94a3b8"
                            : "linear-gradient(120deg, #0ea5e9, #0284c7)",
                          color: "white",
                          fontWeight: 600,
                          cursor:
                            submittingRequestId === slot.requestSubmitKey
                              ? "not-allowed"
                              : "pointer",
                        }}
                      >
                        {submittingRequestId === slot.requestSubmitKey
                          ? "Sending..."
                          : "Submit request"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveRequestKey(null)}
                        style={{
                          padding: "9px 16px",
                          borderRadius: "10px",
                          border: "1px solid rgba(148,163,184,0.4)",
                          backgroundColor: "white",
                          color: "#475569",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {relevantSessions.length ? (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '10px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              {showPast ? 'Showing up to 90 days history.' : 'Showing upcoming & last 7 days.'}
            </span>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={onToggleShowPast}
                style={{
                  padding: '8px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(148,163,184,0.4)',
                  backgroundColor: showPast ? 'rgba(59,130,246,0.1)' : 'white',
                  color: showPast ? '#1d4ed8' : '#0f172a',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {showPast ? 'Hide past sessions' : 'Show past sessions'}
              </button>
            </div>
          </div>

      {relevantSessions.map((session) => {
        const course = courseMap.get(session.courseId);
        const attendance = attendanceMap.get(session.id);
        const relatedRequest = requestsBySession.get(session.id);
        const statusKey = attendance?.status || 'pending';
        const statusStyle = statusStyles[statusKey] || statusStyles.pending;
        const requestStyle =
          relatedRequest && requestStatusStyles[relatedRequest.status || 'pending'];
        const isSubmitting = submittingRequestId === session.id;
        const sessionDate = session.date
        ? new Date((session.date || '') + 'T' + (session.startTime || '00:00'))
          : null;
        const sessionDateLabel = sessionDate ? sessionDate.toLocaleString() : 'Date TBA';
        const sessionTitle = session.title || course?.title || 'Lesson';
        const locationLabel = session.location || (session.meetingUrl ? 'Online · Zoom' : null);
        const relativeTimeLabel = sessionDate ? formatRelativeTime(sessionDate) : '';
        const focusSummary = session.notes || 'Awaiting teacher notes';
        const chipItems = [
          relativeTimeLabel && {
            key: 'time',
            icon: '🕒',
            text: relativeTimeLabel,
            background: 'rgba(14,165,233,0.12)',
            color: '#0369a1',
          },
          locationLabel && {
            key: 'location',
            icon: '📍',
            text: locationLabel,
            background: 'rgba(15,23,42,0.04)',
            color: '#0f172a',
          },
          {
            key: 'focus',
            icon: '🎯',
            text: focusSummary,
            background: 'rgba(129,140,248,0.15)',
            color: '#4338ca',
          },
        ].filter(Boolean);

        return (
          <article
            key={session.id}
            style={{
              borderRadius: '20px',
              border: '1px solid rgba(148,163,184,0.2)',
              backgroundColor: 'white',
              padding: '20px',
              boxShadow: '0 12px 30px rgba(15,23,42,0.04)',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'grid', gap: '6px' }}>
                <h3
                  style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    color: '#0f172a',
                    margin: 0,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {sessionTitle}
                </h3>
                <p style={{ fontSize: '13px', color: '#475569', margin: 0, lineHeight: 1.5 }}>
                  {sessionDateLabel}
                </p>
              </div>
              <div style={{ display: 'grid', gap: '8px', justifyItems: 'end' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '4px 12px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: statusStyle.color,
                    backgroundColor: statusStyle.background,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {statusStyle.label}
                </span>
              </div>
            </div>

            {chipItems.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '-4px' }}>
                {chipItems.map((chip) => (
                  <span
                    key={chip.key}
                    style={{
                      ...metaChipBaseStyle,
                      backgroundColor: chip.background,
                      color: chip.color,
                    }}
                  >
                    <span>{chip.icon}</span>
                    <span style={{ lineHeight: 1.3 }}>{chip.text}</span>
                  </span>
                ))}
              </div>
            )}

            <p style={{ fontSize: '11px', color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>
              {attendance?.markedAt
                ? 'Marked ' + new Date(attendance.markedAt).toLocaleString()
                : 'Attendance pending instructor review.'}
            </p>

            {relatedRequest && (
              <div
                style={{
                  borderRadius: '14px',
                  padding: '12px',
                  backgroundColor: (requestStyle && requestStyle.background) || 'rgba(233,233,233,0.4)',
                  color: (requestStyle && requestStyle.color) || '#475569',
                  fontSize: '12px',
                  lineHeight: 1.5,
                }}
              >
                {(() => {
                  const requestStatus = (relatedRequest.status || "pending").toLowerCase();
                  const displayDate =
                    requestStatus === "approved"
                      ? relatedRequest.approvedDate || relatedRequest.requestedDate
                      : relatedRequest.requestedDate;
                  const displayTime =
                    requestStatus === "approved"
                      ? relatedRequest.approvedTime || relatedRequest.requestedTime
                      : relatedRequest.requestedTime;
                  return (
                    <>
                <strong style={{ fontWeight: 600 }}>Reschedule request:</strong>{' '}
                {(requestStyle && requestStyle.label) || (relatedRequest && relatedRequest.status)}
                {displayDate
                  ? ' · ' + displayDate + (displayTime ? ' ' + displayTime : '')
                  : ''}
                {relatedRequest?.message ? ' · ' + relatedRequest.message : ''}
                {relatedRequest?.resolutionNote ? ' · Instructor note: ' + relatedRequest.resolutionNote : ''}
                    </>
                  );
                })()}
              </div>
            )}

          </article>
        );
      })}
        </>
      ) : (
        <p style={{ marginTop: "4px", fontSize: "13px", color: "#475569" }}>
          No scheduled lessons yet. Your attendance records will appear here once sessions are scheduled.
        </p>
      )}
    </div>
  );
}
function StudentMaterials({ enrolledCourses, hasEnrollments, searchActive }) {
  if (!hasEnrollments) {
    return (
      <p style={{ marginTop: "14px", fontSize: "13px", color: "#475569" }}>
        Enroll in a course to unlock videos, sheet music, and practice tracks.
      </p>
    );
  }

  if (!enrolledCourses.length) {
    return (
      <p style={{ marginTop: "14px", fontSize: "13px", color: "#475569" }}>
        {searchActive
          ? "No learning materials match your search."
          : "Your instructor hasn’t shared materials yet."}
      </p>
    );
  }

  return (
    <div style={{ marginTop: "14px", display: "grid", gap: "18px" }}>
      {enrolledCourses.map((course) => {
        const resources = course.teacherMaterials || [];
        const isPaid = hasPaidAccess(course.enrollment);

        return (
          <article
            key={course.id}
            style={{
              borderRadius: "16px",
              border: "1px solid rgba(206,217,232,0.7)",
              padding: "18px",
              backgroundColor: "white",
              boxShadow: "0 12px 30px rgba(15, 23, 42, 0.04)",
            }}
          >
            <header
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
                marginBottom: "12px",
              }}
            >
              <div>
                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a" }}>{course.title}</h3>
                {course.enrollment?.studentName && (
                  <p style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    {course.enrollment.studentName}
                  </p>
                )}
              </div>
              <span
                style={{
                  padding: "4px 12px",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontWeight: 600,
                  backgroundColor: "rgba(37,99,235,0.08)",
                  color: "#1d4ed8",
                  alignSelf: "flex-start",
                }}
              >
                {resources.length ? `${resources.length} item${resources.length > 1 ? "s" : ""}` : "No files"}
              </span>
            </header>

            {resources.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#94a3b8" }}>
                Your instructor hasn’t shared materials for this course yet.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "12px" }}>
                {resources.map((item) => {
                  const displayTitle = item.title || item.label || "Shared resource";
                  const typeKey = (item.type || "resource").toLowerCase();
                  const typeLabel = (item.type || "resource").toUpperCase();
                  const typeIcon =
                    {
                      video: "🎬",
                      sheet: "🎼",
                      assignment: "📝",
                      link: "🔗",
                    }[typeKey] || "📁";

                  return (
                    <li
                      key={item.id || item.url || item.title}
                      style={{
                        border: "1px solid rgba(226,232,240,0.8)",
                        borderRadius: "12px",
                        padding: "12px",
                        display: "grid",
                        gap: "6px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: "8px",
                          alignItems: "center",
                        }}
                      >
                        <p style={{ fontSize: "13px", color: "#0f172a", fontWeight: 600, margin: 0 }}>
                          {item.url && isPaid ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: "#2563eb", textDecoration: "none" }}
                            >
                              {`${typeIcon} ${displayTitle}`}
                            </a>
                          ) : (
                            <span style={{ color: isPaid ? "#0f172a" : "#94a3b8" }}>
                              {`${typeIcon} ${displayTitle}`}
                            </span>
                          )}
                        </p>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            color: "#0369a1",
                            backgroundColor: "rgba(14,165,233,0.12)",
                            padding: "2px 8px",
                            borderRadius: "999px",
                          }}
                        >
                          {typeLabel}
                        </span>
                      </div>
                      {item.description && (
                        <p style={{ margin: 0, fontSize: "12px", color: "#475569" }}>{item.description}</p>
                      )}
                      <p style={{ margin: 0, fontSize: "11px", color: "#94a3b8" }}>
                        {(item.topic && `Topic: ${item.topic} · `) || ""}
                        {item.source === "teacher" ? "Uploaded by your instructor" : "Shared resource"}
                        {item.updatedAt
                          ? ` · Updated ${new Date(item.updatedAt).toLocaleDateString()}`
                          : ""}
                      </p>
                      {!isPaid && (
                        <span style={{ fontSize: "11px", color: "#b91c1c", fontWeight: 600 }}>
                          Payment required to access.
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}

function StudentProgress({ enrolledCourses }) {
  if (!enrolledCourses.length) {
    return (
      <p style={{ marginTop: "14px", fontSize: "13px", color: "#475569" }}>
        Track completion once you enroll in a course.
      </p>
    );
  }

  return (
    <div style={{ marginTop: "14px", display: "grid", gap: "16px" }}>
      {enrolledCourses.map((course) => {
        const progressRecord = course.progressRecord || null;
        const rawProgress = Number(course.progress);
        const percent = Number.isFinite(rawProgress)
          ? Math.max(0, Math.min(100, Math.round(rawProgress)))
          : 0;
        const note =
          (progressRecord?.note ??
            course.enrollment?.progressNote ??
            "").trim();
        const updatedAt = progressRecord?.updatedAt ?? course.enrollment?.progressUpdatedAt ?? null;
        const updatedBy = progressRecord?.updatedBy ?? course.enrollment?.progressUpdatedBy ?? null;
        const updatedLabel = updatedAt
          ? `${new Date(updatedAt).toLocaleString()}${updatedBy ? ` · ${updatedBy}` : ""}`
          : null;

        return (
          <div
            key={course.id}
            style={{
              borderRadius: "14px",
              border: "1px solid rgba(206,217,232,0.7)",
              padding: "16px",
              backgroundColor: "white",
              display: "grid",
              gap: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div>
                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a" }}>
                  {course.title}
                </h3>
                {course.enrollment?.studentName && (
                  <p style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>
                    Student: {course.enrollment.studentName}
                  </p>
                )}
              </div>
              <span style={{ fontSize: "13px", color: "#0369a1", fontWeight: 600 }}>
                {percent}%
              </span>
            </div>

            <div
              style={{
                height: "8px",
                borderRadius: "999px",
                backgroundColor: "#e2e8f0",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${percent}%`,
                  height: "100%",
                  background: "linear-gradient(120deg, #2563eb, #1d4ed8)",
                }}
              />
            </div>

            {note ? (
              <p style={{ fontSize: "12px", color: "#475569" }}>
                <span style={{ fontWeight: 600, color: "#0f172a" }}>Instructor note:</span> {note}
              </p>
            ) : (
              <p style={{ fontSize: "12px", color: "#94a3b8" }}>Awaiting instructor notes.</p>
            )}

            <p style={{ fontSize: "11px", color: "#94a3b8" }}>
              {updatedLabel
                ? `Last updated ${updatedLabel}`
                : "Instructor has not updated progress yet."}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function StudentPayments({ paidCourses }) {
  if (!paidCourses?.length) {
    return (
      <p style={{ marginTop: "14px", fontSize: "13px", color: "#475569" }}>
        No completed payments yet. Paid enrollments will appear here with receipts.
      </p>
    );
  }

  const formatAmount = (amount, currency) => {
    if (typeof amount !== "number") return "—";
    const code = (currency || "MYR").toUpperCase();
    try {
      return new Intl.NumberFormat("en-MY", { style: "currency", currency: code }).format(
        amount / 100
      );
    } catch (error) {
      return `${(amount / 100).toFixed(2)} ${code}`;
    }
  };

  return (
    <div style={{ marginTop: "14px", display: "grid", gap: "14px" }}>
      {paidCourses.map((course) => {
        const enrollment = course.enrollment || {};
        const receiptUrl = enrollment.paymentReceiptUrl || "";
        const amountLabel = formatAmount(enrollment.paymentAmount, enrollment.paymentCurrency);
        const paidAt = enrollment.paidAt || enrollment.enrolledAt || "";
        const paidLabel = paidAt ? new Date(paidAt).toLocaleString() : "—";

        return (
          <article
            key={course.id}
            style={{
              borderRadius: "16px",
              border: "1px solid rgba(226,232,240,0.9)",
              padding: "16px",
              backgroundColor: "white",
              boxShadow: "0 12px 24px rgba(15,23,42,0.04)",
              display: "grid",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "#0f172a" }}>
                  {course.title}
                </h3>
                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>
                  Instructor: {course.teacher}
                </p>
              </div>
              <span
                style={{
                  alignSelf: "flex-start",
                  padding: "4px 12px",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontWeight: 600,
                  backgroundColor: "rgba(34,197,94,0.12)",
                  color: "#15803d",
                }}
              >
                Paid
              </span>
            </div>

            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "12px", color: "#475569" }}>
              <span>Amount: <strong style={{ color: "#0f172a" }}>{amountLabel}</strong></span>
              <span>Paid at: <strong style={{ color: "#0f172a" }}>{paidLabel}</strong></span>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <Link
                href={`/courses/${course.id}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "8px 14px",
                  borderRadius: "999px",
                  border: "1px solid rgba(148,163,184,0.5)",
                  backgroundColor: "white",
                  color: "#0f172a",
                  textDecoration: "none",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                View course
              </Link>
              {receiptUrl ? (
                <a
                  href={receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "8px 14px",
                    borderRadius: "999px",
                    border: "1px solid rgba(37,99,235,0.4)",
                    backgroundColor: "rgba(37,99,235,0.08)",
                    color: "#1d4ed8",
                    textDecoration: "none",
                    fontSize: "12px",
                    fontWeight: 600,
                  }}
                >
                  Open receipt
                </a>
              ) : (
                <span style={{ fontSize: "12px", color: "#94a3b8" }}>Receipt pending</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
