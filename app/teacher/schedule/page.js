"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {addDoc,collection,deleteDoc,doc,getDocs,onSnapshot,orderBy,query,serverTimestamp,setDoc,updateDoc,where,writeBatch,} from "firebase/firestore";
import { courseCatalog } from "@/lib/courseCatalog";
import { db } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";

const attendanceStatuses = [
  { value: "present", label: "Present", color: "#15803d", background: "#dcfce7" },
  { value: "absent", label: "Absent", color: "#b91c1c", background: "#fee2e2" },
  { value: "excused", label: "Excused", color: "#0369a1", background: "#e0f2fe" },
];

export default function TeacherSchedulePage() {

  const router = useRouter();
  const { sessionUser, loading } = useSessionUser();
  const [sessions, setSessions] = useState([]);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [sessionStudents, setSessionStudents] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [formCourseId, setFormCourseId] = useState(courseCatalog[0]?.id ?? "");
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formStartTime, setFormStartTime] = useState("");
  const [formEndTime, setFormEndTime] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [rescheduleRequests, setRescheduleRequests] = useState([]);
  const [resolutionDrafts, setResolutionDrafts] = useState({});
  const [processingRequestId, setProcessingRequestId] = useState(null);
  const [showResolvedRequests, setShowResolvedRequests] = useState(false);
  const [requestFilter, setRequestFilter] = useState("pending");

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

  useEffect(() => {
    const courseId = sessions.find((session) => session.id === selectedSessionId)?.courseId;
    if (!courseId) {
      setSessionStudents([]);
      return;
    }
//找到所有报名这个课程的学生
    const studentsQuery = query(collection(db, "enrollments"), where("courseId", "==", courseId));
    const unsubscribe = onSnapshot(
      studentsQuery,
      (snapshot) => {
        const students = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            studentUid: data.studentUid || "",
            studentEmail: data.studentEmail || "",
            studentName: data.studentName || data.studentEmail || "Student",
          };
        });
        setSessionStudents(students);
      },
      (error) => {
        console.error("Failed to load enrolled students", error);
        setSessionStudents([]);
      }
    );

    return () => unsubscribe();
  }, [sessions, selectedSessionId]);

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

        await updateDoc(doc(db, "sessions", request.sessionId), {
          date: newDate,
          startTime: newTime,
          updatedAt: serverTimestamp(),
        });

        await updateDoc(doc(db, "rescheduleRequests", request.id), {
          status: "approved",
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

  async function handleDeleteResolvedRequest(requestId) {
    if (!confirm("Remove this resolved request from the list?")) {
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
    if (!sessionUser?.uid) {
        setRescheduleRequests([]);
        return;
      }

    const requestsQuery = query(
      collection(db, "rescheduleRequests"),
      where("teacherUid", "==", sessionUser.uid),
      orderBy("createdAt", "desc")
    );
//实时更新更改情况
    const unsubscribe = onSnapshot(
      requestsQuery,
      (snapshot) => {
        const records = snapshot.docs.map((docSnapshot) => {
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
        });
        setRescheduleRequests(records);
      },
      (error) => {
        console.error("Failed to load reschedule requests", error);
        setRescheduleRequests([]);
      }
    );

    return () => unsubscribe();
  }, [sessionUser?.uid]);

//sessions 按日期分成
  const sessionsByDate = useMemo(() => {
    const upcoming = [];
    const past = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const session of sessions) {
      const sessionDate = new Date(`${session.date}T${session.startTime || "00:00"}`);
      if (sessionDate >= today) {
        upcoming.push(session);
      } else {
        past.push(session);
      }
    }

    upcoming.sort(
      (a, b) => new Date(`${a.date}T${a.startTime || "00:00"}`) - new Date(`${b.date}T${b.startTime || "00:00"}`)
    );
    past.sort(
      (a, b) => new Date(`${b.date}T${b.startTime || "00:00"}`) - new Date(`${a.date}T${a.startTime || "00:00"}`)
    );
    return { upcoming, past };
  }, [sessions]);

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

  const summaryCounts = useMemo(() => {
    const upcomingCount = sessionsByDate.upcoming.length;
    const thisWeekCount = sessionsByDate.upcoming.filter((s) => {
      const diffDays =
        (new Date(`${s.date}T${s.startTime || "00:00"}`) - new Date()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 7;
    }).length;
    const requestCounts = {
      pending: pendingRequests.length,
      resolved: resolvedRequests.length,
    };
    return { upcomingCount, thisWeekCount, requestCounts };
  }, [sessionsByDate.upcoming, pendingRequests, resolvedRequests]);

//当前选中的课程
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  const studentsForSelectedSession = useMemo(() => {
    return sessionStudents
      .map((entry) => ({
        studentEmail: entry.studentEmail || "",
        studentName: entry.studentName || entry.studentEmail || "Student",
        studentUid: entry.studentUid || "",
      }))
      .sort((a, b) => (a.studentName || "").localeCompare(b.studentName || ""));
  }, [sessionStudents]);

  function handleCreateSession(event) {
    event.preventDefault();
    if (!formCourseId || !formDate) {
      alert("Please select a course and date for the session.");
      return;
    }

    const course = courseCatalog.find((item) => item.id === formCourseId);

    addDoc(collection(db, "sessions"), {
      courseId: formCourseId,
      courseTitle: course?.title || "",
      courseLevel: course?.level || "",
      title: formTitle.trim() || `${course?.title || "Lesson"} Session`,
      date: formDate,
      startTime: formStartTime,
      endTime: formEndTime,
      location: formLocation.trim(),
      notes: formNotes.trim(),
      teacherUid: sessionUser.uid,
      teacherEmail: sessionUser.email || "",
      createdAt: serverTimestamp(),
    })
      .then((docRef) => {
        setSelectedSessionId(docRef.id);
        setFormTitle("");
        setFormDate("");
        setFormStartTime("");
        setFormEndTime("");
        setFormLocation("");
        setFormNotes("");
      })
      .catch((error) => {
        console.error("Failed to create session", error);
        alert("Unable to create session. Please try again.");
      });
  }

  async function handleDeleteSession(sessionId) {
    if (!confirm("Delete this session? Attendance records for this session will also be removed.")) {
      return;
    }

    try {
      const sessionRef = doc(db, "sessions", sessionId);
      const attendanceSnapshot = await getDocs(collection(sessionRef, "attendance"));
      if (!attendanceSnapshot.empty) {
        const batch = writeBatch(db);
        attendanceSnapshot.forEach((docSnapshot) => batch.delete(docSnapshot.ref));
        await batch.commit();
      }
      await deleteDoc(sessionRef);
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
      }
    } catch (error) {
      console.error("Failed to delete session", error);
      alert("Unable to delete this session right now.");
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
        background: "radial-gradient(circle at top, #eef2ff 0%, #e0f2fe 40%, #f8fafc 100%)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        padding: "48px 24px",
      }}
    >
      <section
        style={{
          maxWidth: "1080px",
          margin: "0 auto",
          borderRadius: "28px",
          backgroundColor: "rgba(255,255,255,0.96)",
          boxShadow: "0 28px 60px rgba(15, 23, 42, 0.18)",
          border: "1px solid rgba(226,232,240,0.6)",
          padding: "40px",
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
                padding: "6px 16px",
                borderRadius: "999px",
                backgroundColor: "rgba(59,130,246,0.15)",
                color: "#1d4ed8",
                fontSize: "12px",
                fontWeight: 600,
                letterSpacing: "0.16em",
              }}
            >
              SCHEDULE & ATTENDANCE
            </p>
            <h1
              style={{
                marginTop: "18px",
                fontSize: "30px",
                fontWeight: 700,
                color: "#0f172a",
              }}
            >
              Manage lesson schedule and attendance
            </h1>
            <p style={{ marginTop: "8px", color: "#475569", fontSize: "14px" }}>
              Create sessions, track attendance, and keep a pulse on student participation.
            </p>
          </div>
          <Link
            href="/teacher/dashboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 16px",
              borderRadius: "10px",
              border: "1px solid rgba(148,163,184,0.5)",
              color: "#0f172a",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Back to dashboard
          </Link>
        </header>

        {/* 两列布局：左主体，右侧粘性概要/待办 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(320px, 1fr)",
            gap: "18px",
            alignItems: "start",
          }}
        >
          {/* 左列 */}
          <div style={{ display: "grid", gap: "18px" }}>
            {/* 创建会话表单 */}
            <section
              style={{
                borderRadius: "18px",
                border: "1px solid rgba(226,232,240,0.7)",
                padding: "24px",
                backgroundColor: "white",
                display: "grid",
                gap: "16px",
              }}
            >
              <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#0f172a" }}>Create a lesson session</h2>
             <form
                    onSubmit={handleCreateSession}
                    style={{
                    display: "grid",
                    gap: "14px",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  }}
                >
                  <label
                    style={{
                      display: "grid",
                      gap: "6px",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#0f172a",
                    }}
                  >
                    Course
                    <select
                      value={formCourseId}
                      onChange={(event) => setFormCourseId(event.target.value)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid #cbd5f5",
                        fontSize: "14px",
                      }}
                    >
                      {courseCatalog.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.title}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label
                    style={{
                      display: "grid",
                      gap: "6px",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#0f172a",
                    }}
                  >
                    Session title
                    <input
                      type="text"
                      value={formTitle}
                      onChange={(event) => setFormTitle(event.target.value)}
                      placeholder="e.g. Technique workshop"
                      style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid #cbd5f5",
                        fontSize: "14px",
                      }}
                    />
                  </label>

                  <label
                    style={{
                      display: "grid",
                      gap: "6px",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#0f172a",
                    }}
                  >
                    Date
                    <input
                      type="date"
                      value={formDate}
                      onChange={(event) => setFormDate(event.target.value)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid #cbd5f5",
                        fontSize: "14px",
                      }}
                    />
                  </label>

                  <label
                    style={{
                      display: "grid",
                      gap: "6px",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#0f172a",
                    }}
                  >
                    Start time
                    <input
                      type="time"
                      value={formStartTime}
                      onChange={(event) => setFormStartTime(event.target.value)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid #cbd5f5",
                        fontSize: "14px",
                      }}
                    />
                  </label>

                  <label
                    style={{
                      display: "grid",
                      gap: "6px",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#0f172a",
                    }}
                  >
                    End time
                    <input
                      type="time"
                      value={formEndTime}
                      onChange={(event) => setFormEndTime(event.target.value)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid #cbd5f5",
                        fontSize: "14px",
                      }}
                    />
                  </label>

                  <label
                    style={{
                      display: "grid",
                      gap: "6px",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#0f172a",
                    }}
                  >
                    Location / room
                    <input
                      type="text"
                      value={formLocation}
                      onChange={(event) => setFormLocation(event.target.value)}
                      placeholder="Studio A, Zoom, etc."
                      style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid #cbd5f5",
                        fontSize: "14px",
                      }}
                    />
                  </label>

                  <label
                    style={{
                      gridColumn: "1 / -1",
                      display: "grid",
                      gap: "6px",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#0f172a",
                    }}
                  >
                    Notes for students
                    <textarea
                      value={formNotes}
                      onChange={(event) => setFormNotes(event.target.value)}
                      placeholder="Share focus pieces, reminders, or preparation tips."
                      rows={3}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid #cbd5f5",
                        fontSize: "14px",
                        resize: "vertical",
                      }}
                            />
                          </label>

          <div style={{ gridColumn: "1 / -1" }}>
            <button
              type="submit"
              style={{
                padding: "12px 20px",
                borderRadius: "10px",
                border: "none",
                background: "linear-gradient(120deg, #2563eb, #1d4ed8)",
                color: "white",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 18px 35px rgba(37, 99, 235, 0.30)",
              }}
            >
              Create session
          </button>
        </div>
      </form>
            </section>
            {/* 即将到来 / 历史会话列表 */}
            {sessionsByDate.upcoming.length > 0 && (
              <section
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(226,232,240,0.7)",
                  padding: "18px",
                  backgroundColor: "white",
                  display: "grid",
                  gap: "12px",
                }}
              >
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>Upcoming sessions</h3>
                    <p style={{ margin: 0, fontSize: "12px", color: "#475569" }}>Next lessons you have scheduled.</p>
                  </div>
                </header>
                <div style={{ display: "grid", gap: "10px" }}>
                  {sessionsByDate.upcoming.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      course={courseCatalog.find((c) => c.id === session.courseId)}
                      onManage={() => setSelectedSessionId(session.id)}
                      onDelete={() => handleDeleteSession(session.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {sessionsByDate.past.length > 0 && (
              <section
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(226,232,240,0.7)",
                  padding: "18px",
                  backgroundColor: "white",
                  display: "grid",
                  gap: "12px",
                }}
              >
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>Past sessions</h3>
                    <p style={{ margin: 0, fontSize: "12px", color: "#475569" }}>Recent lessons already completed.</p>
                  </div>
                </header>
                <div style={{ display: "grid", gap: "10px" }}>
                  {sessionsByDate.past.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      course={courseCatalog.find((c) => c.id === session.courseId)}
                      onManage={() => setSelectedSessionId(session.id)}
                      onDelete={() => handleDeleteSession(session.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 出勤面板（若选中某会话） */}
           {selectedSession && (
                 <section
                style={{
                  borderRadius: "18px",
                  border: "1px solid rgba(226,232,240,0.7)",
                  padding: "24px",
                  backgroundColor: "white",
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
                        fontSize: "18px",
                        fontWeight: 600,
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
              gap: "12px",
              position: "sticky",
              top: "24px",
            }}
          >
            {/* This week at a glance */}
            <div
              style={{
                borderRadius: "16px",
                border: "1px solid rgba(226,232,240,0.8)",
                padding: "16px",
                backgroundColor: "white",
                boxShadow: "0 12px 28px rgba(15,23,42,0.1)",
                display: "grid",
                gap: "10px",
              }}
            >
              <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>
                This week at a glance
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px" }}>
                <div style={{ padding: "10px", borderRadius: "10px", background: "rgba(59,130,246,0.08)" }}>
                  <p style={{ margin: 0, fontSize: "11px", color: "#2563eb", fontWeight: 700 }}>Upcoming</p>
                  <p style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 800, color: "#0f172a" }}>
                    {summaryCounts.upcomingCount}
                  </p>
                </div>
                <div style={{ padding: "10px", borderRadius: "10px", background: "rgba(34,197,94,0.08)" }}>
                  <p style={{ margin: 0, fontSize: "11px", color: "#15803d", fontWeight: 700 }}>This week</p>
                  <p style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 800, color: "#0f172a" }}>
                    {summaryCounts.thisWeekCount}
                  </p>
                </div>
                <div style={{ padding: "10px", borderRadius: "10px", background: "rgba(248,113,113,0.08)" }}>
                  <p style={{ margin: 0, fontSize: "11px", color: "#b91c1c", fontWeight: 700 }}>Requests</p>
                  <p style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 800, color: "#0f172a" }}>
                    {pendingRequests.length}
                  </p>
                </div>
              </div>
            </div>

            {/* Reschedule requests */}
            <section
              style={{
                borderRadius: "16px",
                border: "1px solid rgba(226,232,240,0.7)",
                padding: "16px",
                backgroundColor: "white",
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
                  <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#0f172a" }}>Reschedule requests</h2>
                  <p style={{ fontSize: "13px", color: "#475569", marginTop: "4px" }}>
                    Review make-up lesson requests submitted by students.
                  </p>
                </div>
                {resolvedRequests.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowResolvedRequests((prev) => !prev)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "999px",
                      border: "1px solid rgba(148,163,184,0.4)",
                      backgroundColor: "white",
                      color: "#475569",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {showResolvedRequests ? "Hide resolved" : `Show resolved (${resolvedRequests.length})`}
                  </button>
                )}
              </header>

              {!pendingRequests.length ? (
                <p style={{ fontSize: "13px", color: "#475569" }}>No pending requests at the moment.</p>
              ) : (
                pendingRequests.map((request) => {
                  const draft = resolutionDrafts[request.id] || {};
                  const isProcessing = processingRequestId === request.id;
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
                          gap: "10px",
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <p style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                            {request.studentName} · {request.studentEmail}
                          </p>
                          <p style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
                            Course: {request.courseTitle || request.courseId}
                          </p>
                          <p style={{ fontSize: "12px", color: "#94a3b8" }}>
                            Original session: {request.sessionDate} {request.sessionStartTime}
                          </p>
                          {request.requestedDate && (
                            <p style={{ fontSize: "12px", color: "#94a3b8" }}>
                              Preferred date: {request.requestedDate} {request.requestedTime}
                            </p>
                          )}
                          {request.message && (
                            <p style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
                              Student note: {request.message}
                            </p>
                          )}
                        </div>
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

                      {request.status === "pending" ? (
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
                          </div>
                        </form>
                      ) : (
                        <p style={{ fontSize: "12px", color: "#475569" }}>
                          Resolved on{" "}
                          {request.resolvedAt ? new Date(request.resolvedAt).toLocaleString() : "N/A"}
                          {request.resolutionNote ? ` · Note: ${request.resolutionNote}` : ""}
                        </p>
                      )}
                    </article>
                  );
                })
              )}

              {showResolvedRequests && resolvedRequests.length > 0 && (
                <div style={{ marginTop: "4px", display: "grid", gap: "12px" }}>
                  {resolvedRequests.map((request) => {
                    const statusColors = {
                      approved: { color: "#15803d", background: "#dcfce7" },
                      rejected: { color: "#b91c1c", background: "#fee2e2" },
                    };
                    const statusStyle = statusColors[request.status] || { color: "#475569", background: "#e2e8f0" };
                    return (
                      <article
                        key={`resolved-${request.id}`}
                        style={{
                          borderRadius: "12px",
                          border: "1px solid rgba(226,232,240,0.7)",
                          padding: "14px",
                          backgroundColor: "#f8fafc",
                          display: "grid",
                          gap: "8px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "8px",
                          }}
                        >
                          <div>
                            <p style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                              {request.studentName} · {request.studentEmail}
                            </p>
                            <p style={{ fontSize: "12px", color: "#475569" }}>
                              Course: {request.courseTitle || request.courseId}
                            </p>
                            <p style={{ fontSize: "12px", color: "#94a3b8" }}>
                              Resolved on {request.resolvedAt ? new Date(request.resolvedAt).toLocaleString() : "N/A"}
                            </p>
                            {request.resolutionNote && (
                              <p style={{ fontSize: "12px", color: "#475569" }}>Note: {request.resolutionNote}</p>
                            )}
                          </div>
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
                        <button
                          type="button"
                          onClick={() => handleDeleteResolvedRequest(request.id)}
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
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
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
        borderRadius: "16px",
        border: "1px solid rgba(226,232,240,0.9)",
        padding: "18px",
        backgroundColor: "#f8fafc",
        display: "grid",
        gap: "12px",
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
          <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a" }}>
            {session.title || course?.title || "Lesson"}
          </h3>
          <p style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
            {course?.title ? `${course.title}  ` : ""}
            {new Date(`${session.date}T${session.startTime || "00:00"}`).toLocaleString()}
            {session.location ? `  ${session.location}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onManage}
            style={{
              padding: "8px 14px",
              borderRadius: "10px",
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
              borderRadius: "10px",
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