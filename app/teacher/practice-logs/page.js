"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {collection,doc,onSnapshot,orderBy,query,serverTimestamp,setDoc,updateDoc,where,} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";

const makeKey = (email, uid, courseId) => `${uid || email || "student"}::${courseId || "course"}`;

export default function TeacherPracticeLogsPage() {

  const router = useRouter();
  const { sessionUser, loading } = useSessionUser();
  const [logs, setLogs] = useState([]);
  const [courseFilter, setCourseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [feedbackDrafts, setFeedbackDrafts] = useState({});
  const [progressRecords, setProgressRecords] = useState([]);
  const [progressDrafts, setProgressDrafts] = useState({});
  const [activeEnrollments, setActiveEnrollments] = useState(new Set());
  const [enrollmentMap, setEnrollmentMap] = useState(new Map());
  const [enrollmentsLoaded, setEnrollmentsLoaded] = useState(false);

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

  //监听 practiceLogs 
  useEffect(() => {
    if (!sessionUser) return;

    const logsQuery = query(collection(db, "practiceLogs"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        const nextLogs = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate().toISOString()
              : data.createdAt ?? null;
          const updatedAt =
            data.updatedAt && typeof data.updatedAt.toDate === "function"
              ? data.updatedAt.toDate().toISOString()
              : data.updatedAt ?? null;
          const feedbackUpdatedAt =
            data.feedbackUpdatedAt && typeof data.feedbackUpdatedAt.toDate === "function"
              ? data.feedbackUpdatedAt.toDate().toISOString()
              : data.feedbackUpdatedAt ?? null;

          return {
            id: docSnapshot.id,
            ...data,
            createdAt,
            updatedAt,
            feedbackUpdatedAt,
          };
        });
        setLogs(nextLogs);
      },
      (error) => {
        console.error("Failed to load practice logs", error);
        setLogs([]);
      }
    );

    return () => unsubscribe();
  }, [sessionUser]);

  //
  useEffect(() => {
    if (!sessionUser) return;
    const disallowed = new Set(["withdrawn", "cancelled", "canceled"]);
    const enrollmentsQuery = query(collection(db, "enrollments"));
    const unsubscribe = onSnapshot(
      enrollmentsQuery,
      (snapshot) => {
        const next = new Set();
        const nextMap = new Map();
        snapshot.forEach((docSnapshot) => {
          const data = docSnapshot.data();
          const status = (data.status || "").toLowerCase();
          if (disallowed.has(status)) return;
          const key = `${data.studentUid || data.studentEmail || "student"}::${data.courseId || data.id || "course"}`;
          next.add(key);
          nextMap.set(key, {
            courseId: data.courseId || data.id || "",
            courseTitle: data.courseTitle || "",
            courseLevel: data.courseLevel || "",
            studentEmail: data.studentEmail || "",                           
            studentName: data.studentName ||  data.studentEmail || "Student",
            studentUid: data.studentUid || "",
          });
        });
        setActiveEnrollments(next);
        setEnrollmentMap(nextMap);
        setEnrollmentsLoaded(true);
      },
      (error) => {
        console.error("Failed to load enrollments", error);
        setActiveEnrollments(new Set());
        setEnrollmentMap(new Map());
        setEnrollmentsLoaded(true);
      }
    );
    return () => unsubscribe();
  }, [sessionUser]);

  //Course Progress
  useEffect(() => {
    if (!sessionUser) return;

    const progressQuery = query(collection(db, "courseProgress"), orderBy("updatedAt", "desc"));
    const unsubscribe = onSnapshot(
      progressQuery,
      (snapshot) => {
        const nextRecords = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          const courseId =
            data.courseId ??
            (typeof docSnapshot.id === "string" && docSnapshot.id.includes("::")
              ? docSnapshot.id.split("::").pop()
              : null);
          const updatedAt =
            data.updatedAt && typeof data.updatedAt.toDate === "function"
              ? data.updatedAt.toDate().toISOString()
              : data.updatedAt ?? null;

          return {
            id: docSnapshot.id,
            ...data,
             courseId,
            updatedAt,
          };
        });
        setProgressRecords(nextRecords);
      },
      (error) => {
        console.error("Failed to load course progress", error);
        setProgressRecords([]);
      }
    );

    return () => unsubscribe();
  }, [sessionUser]);

  function handleSaveFeedback(entryId) {
    const draft = feedbackDrafts[entryId];
    const entry = logs.find((item) => item.id === entryId);
    const resolvedFeedback = (draft ?? entry?.feedback ?? "").trim();

    updateDoc(doc(db, "practiceLogs", entryId), {
      feedback: resolvedFeedback,
      status: "reviewed",
      feedbackUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
      .then(() => {
        setFeedbackDrafts((prev) => {
          const next = { ...prev };
          delete next[entryId];
          return next;
        });
      })
      .catch((error) => {
        console.error("Failed to save feedback", error);
        alert("Unable to save feedback. Please try again.");
      });
  }
//更新 practiceLogs 这条记录
  function handleStatusChange(entryId, status) {
    updateDoc(doc(db, "practiceLogs", entryId), {
      status,
      updatedAt: serverTimestamp(),
    }).catch((error) => {
      console.error("Failed to update status", error);
      alert("Unable to update status. Please try again.");
    });
  }

  function getProgressRecordId(item) {
    if (item?.id) return item.id;
    return makeKey(item?.studentEmail, item?.studentUid, item?.courseId);
  }

  function handleSaveProgress(item) {
    const draft = progressDrafts[item.id];
    const resolvedProgress =
      typeof draft?.progress === "number"
        ? Math.max(0, Math.min(100, Math.round(draft.progress)))
        : typeof item.progress === "number"
        ? Math.max(0, Math.min(100, Math.round(item.progress)))
        : 0;
    const resolvedNote = (draft?.note ?? item.note ?? "").trim();

    const recordId = getProgressRecordId(item);

    const payload = {
      courseId: item.courseId,
      courseTitle: item.courseTitle,
      courseLevel: item.courseLevel,
      studentUid: item.studentUid || "",
      studentEmail: item.studentEmail || "",
      studentName: item.studentName || item.studentEmail || "Student",
      progress: resolvedProgress,
      note: resolvedNote,
      updatedBy: sessionUser?.email ?? "instructor",
    };

    setDoc(
      doc(db, "courseProgress", recordId),
      {
        ...payload,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    )
      .then(async () => {
        if (item.studentUid) {
          const enrollmentId = `${item.studentUid}_${item.courseId}`;
          try {
            await updateDoc(doc(db, "enrollments", enrollmentId), {
              progress: resolvedProgress,
              progressNote: resolvedNote,
              progressUpdatedAt: serverTimestamp(),
              progressUpdatedBy: sessionUser?.email ?? "instructor",
            });
          } catch (error) {
            console.warn("Failed to update enrollment progress", error);
          }
        }

        setProgressDrafts((prev) => {
          const nextDrafts = { ...prev };
          delete nextDrafts[item.id];
          return nextDrafts;
        });
      })
      .catch((error) => {
        console.error("Failed to save course progress", error);
        alert("Unable to save progress. Please try again.");
      });
  }
//生成课程筛选用的课程列表
  const coursesForFilter = useMemo(() => {
    const seen = new Map();
    const addCourse = (id, title) => {
      if (!id || !title) return;
      if (!seen.has(id)) seen.set(id, title);
    };

    logs.forEach((entry) => addCourse(entry.courseId, entry.courseTitle));
    enrollmentMap.forEach((enrollment) => addCourse(enrollment.courseId, enrollment.courseTitle));
    progressRecords.forEach((rec) => addCourse(rec.courseId, rec.courseTitle));

    return Array.from(seen.entries()).sort((a, b) => (a[1] || "").localeCompare(b[1] || ""));
  }, [logs, enrollmentMap, progressRecords]);

//老师端练习记录列表的总过滤器
  const filteredLogs = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const allowCourse = (email, uid, courseId) => {
      const key = makeKey(email, uid, courseId);
      if (!enrollmentsLoaded) return true;
      return activeEnrollments.has(key);
    };

    return logs.filter((entry) => {
      if (!allowCourse(entry.studentEmail, entry.studentUid, entry.courseId)) return false;
      const matchesCourse = courseFilter === "all" || entry.courseId === courseFilter;
      const matchesStatus = statusFilter === "all" || (entry.status || "pending") === statusFilter;
      const matchesSearch =
        !search ||
        entry.studentEmail?.toLowerCase().includes(search) ||
        entry.studentName?.toLowerCase().includes(search);
      return matchesCourse && matchesStatus && matchesSearch;
    });
  }, [logs, courseFilter, statusFilter, searchTerm, activeEnrollments, enrollmentsLoaded]);

  const groupedLogs = useMemo(() => {
    const map = new Map();
    for (const entry of filteredLogs) {
      const key = entry.courseTitle || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    }
    return Array.from(map.entries());
  }, [filteredLogs]);

  const [collapsedGroups, setCollapsedGroups] = useState({});
  const toggleGroup = (key) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const progressItems = useMemo(() => {
    const allowCourse = (email, uid, courseId) => {
      const key = makeKey(email, uid, courseId);
      if (!enrollmentsLoaded) return true;
      return activeEnrollments.has(key);
    };

    const map = new Map();

    // start with enrollments to ensure current sign-ups appear
    enrollmentMap.forEach((enrollment) => {
      if (!enrollment.courseId || !enrollment.courseTitle) return;
      const key = makeKey(enrollment.studentEmail, enrollment.studentUid, enrollment.courseId);
      map.set(key, {
        id: key,
        courseId: enrollment.courseId,
        courseTitle: enrollment.courseTitle,
        courseLevel: enrollment.courseLevel,
        studentEmail: enrollment.studentEmail,
        studentName: enrollment.studentName,
        studentUid: enrollment.studentUid,
        progress: 0,
        note: "",
        updatedAt: null,
      });
    });

    for (const record of progressRecords) {
      if (!record || !record.courseId || !record.courseTitle) continue;
      const key = makeKey(record.studentEmail, record.studentUid, record.courseId);
      if (!allowCourse(record.studentEmail, record.studentUid, record.courseId)) continue;
      map.set(key, { ...map.get(key), ...record, id: key });
    }
    for (const entry of logs) {
      if (!entry.courseId || !entry.courseTitle) continue;
      if (!allowCourse(entry.studentEmail, entry.studentUid, entry.courseId)) continue;
      const key = makeKey(entry.studentEmail, entry.studentUid, entry.courseId);
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          courseId: entry.courseId,
          courseTitle: entry.courseTitle || "Course",
          courseLevel: entry.courseLevel || "",
          studentEmail: entry.studentEmail || "",
          studentName: entry.studentName || entry.studentEmail || "Student",
          studentUid: entry.studentUid || "",
          progress: 0,
          note: "",
          updatedAt: null,
        });
      } else {
        const existing = map.get(key);
        if (!existing.studentEmail && entry.studentEmail) existing.studentEmail = entry.studentEmail;
        if (!existing.studentName && entry.studentName) existing.studentName = entry.studentName;
        if (!existing.studentUid && entry.studentUid) existing.studentUid = entry.studentUid;
        if (!existing.courseTitle && entry.courseTitle) existing.courseTitle = entry.courseTitle;
        if (!existing.courseLevel && entry.courseLevel) existing.courseLevel = entry.courseLevel;
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const courseCompare = (a.courseTitle || "").localeCompare(b.courseTitle || "");
      if (courseCompare !== 0) return courseCompare;
      return (a.studentName || "").localeCompare(b.studentName || "");
    });
  }, [progressRecords, logs, activeEnrollments, enrollmentsLoaded, enrollmentMap]);

  const filteredProgressItems = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return progressItems.filter((item) => {
      const matchesCourse = courseFilter === "all" || item.courseId === courseFilter;
      const matchesSearch =
        !search ||
        item.studentEmail?.toLowerCase().includes(search) ||
        item.studentName?.toLowerCase().includes(search);
      return matchesCourse && matchesSearch;
    });
  }, [progressItems, courseFilter, searchTerm]);

  const statusCounts = useMemo(() => {
    const counts = { pending: 0, reviewed: 0, attention: 0 };
    filteredLogs.forEach((entry) => {
      const state = (entry.status || "pending").toLowerCase();
      if (state === "reviewed") counts.reviewed += 1;
      else if (state === "attention") counts.attention += 1;
      else counts.pending += 1;
    });
    return counts;
  }, [filteredLogs]);

  const averageProgress = useMemo(() => {
    if (!filteredProgressItems.length) return 0;
    const sum = filteredProgressItems.reduce((acc, item) => acc + (Number(item.progress) || 0), 0);
    return Math.round(sum / filteredProgressItems.length);
  }, [filteredProgressItems]);

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
          maxWidth: "1100px",
          margin: "0 auto",
          borderRadius: "28px",
          backgroundColor: "rgba(255,255,255,0.98)",
          boxShadow: "0 28px 60px rgba(15, 23, 42, 0.16)",
          border: "1px solid rgba(226,232,240,0.65)",
          padding: "36px",
          display: "grid",
          gap: "24px",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
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
                backgroundColor: "rgba(14,165,233,0.15)",
                color: "#0369a1",
                fontSize: "12px",
                fontWeight: 600,
                letterSpacing: "0.16em",
              }}
            >
              STUDENT PRACTICE LOGS
            </p>
            <h1
              style={{
                marginTop: "18px",
                fontSize: "30px",
                fontWeight: 700,
                color: "#0f172a",
              }}
            >
              Review student practice progress
            </h1>
            <p style={{ marginTop: "8px", color: "#475569", fontSize: "14px" }}>
              Monitor submissions, listen to clips, and leave actionable feedback.
            </p>
          </div>
          <Link
            href="/teacher/dashboard"
            style={{
              alignSelf: "flex-start",
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

        <section
          style={{
            borderRadius: "20px",
            border: "1px solid rgba(226,232,240,0.9)",
            padding: "18px",
            backgroundColor: "rgba(248,250,252,0.96)",
            boxShadow: "0 14px 32px rgba(148,163,184,0.14)",
            display: "grid",
            gap: "16px",
          }}
        >
          <div
            style={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            }}
          >
            <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
              Course
              <select
                value={courseFilter}
                onChange={(event) => setCourseFilter(event.target.value)}
                style={{
                  padding: "12px 14px",
                  borderRadius: "14px",
                  border: "1px solid rgba(148,163,184,0.6)",
                  fontSize: "14px",
                  color: "#0f172a",
                  backgroundColor: "#f8fafc",
                }}
              >
                <option value="all">All courses</option>
                {coursesForFilter.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                style={{
                  padding: "12px 14px",
                  borderRadius: "14px",
                  border: "1px solid rgba(148,163,184,0.6)",
                  fontSize: "14px",
                  color: "#0f172a",
                  backgroundColor: "#f8fafc",
                }}
              >
                <option value="all">All statuses</option>
                <option value="pending">Pending review</option>
                <option value="reviewed">Reviewed</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
              Search student
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="email or name"
                style={{
                  padding: "12px 14px",
                  borderRadius: "14px",
                  border: "1px solid rgba(148,163,184,0.6)",
                  fontSize: "14px",
                  color: "#0f172a",
                  backgroundColor: "#f8fafc",
                }}
              />
            </label>
          </div>
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)",
            gap: "18px",
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: "18px" }}>
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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <div>
              <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#0f172a" }}>Course progress</h2>
              <p style={{ fontSize: "13px", color: "#475569", marginTop: "4px" }}>
                Adjust each student&apos;s completion percentage and leave a short milestone note.
              </p>
            </div>
          </div>

          {filteredProgressItems.length === 0 ? (
            <p style={{ fontSize: "13px", color: "#475569" }}>
              No students match the current filters. Encourage students to log practice to start tracking progress.
            </p>
          ) : (
            filteredProgressItems.map((item) => {
              const draft = progressDrafts[item.id];
              const progressValue =
                typeof draft?.progress === "number"
                  ? draft.progress
                  : typeof item.progress === "number"
                  ? item.progress
                  : 0;
              const sliderValue = Number.isFinite(Number(progressValue)) ? Number(progressValue) : 0;
              const displayProgress = Math.max(0, Math.min(100, Math.round(sliderValue)));
              const noteValue = draft?.note ?? item.note ?? "";
              const lastUpdated = item.updatedAt
                ? new Date(item.updatedAt).toLocaleString()
                : null;

              return (
                <article
                  key={item.id}
                  style={{
                    borderRadius: "18px",
                    border: "1px solid rgba(226,232,240,0.8)",
                    padding: "18px",
                    backgroundColor: "white",
                    boxShadow: "0 16px 34px rgba(15,23,42,0.08)",
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  <header
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
                        {item.studentName} · {item.studentEmail || "email unavailable"}
                      </p>
                      <p style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
                        {item.courseTitle}
                        {item.courseLevel ? ` (${item.courseLevel})` : ""}
                      </p>
                    </div>
                    <span
                      style={{
                        padding: "6px 10px",
                        borderRadius: "999px",
                        backgroundColor: "rgba(59,130,246,0.1)",
                        color: "#1d4ed8",
                        fontWeight: 700,
                        fontSize: "12px",
                      }}
                    >
                      {displayProgress}%
                    </span>
                  </header>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={sliderValue}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setProgressDrafts((prev) => {
                          const prevDraft = prev[item.id] ?? {};
                          return {
                            ...prev,
                            [item.id]: {
                              progress: value,
                              note: prevDraft.note ?? item.note ?? "",
                            },
                          };
                        });
                      }}
                      style={{ flexGrow: 1, accentColor: "#2563eb" }}
                    />
                  </div>

                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>
                      Milestone / instructor note
                    </span>
                    <textarea
                      value={noteValue}
                      onChange={(event) => {
                        const value = event.target.value;
                        setProgressDrafts((prev) => {
                          const prevDraft = prev[item.id] ?? {};
                          return {
                            ...prev,
                            [item.id]: {
                              progress:
                                typeof prevDraft.progress === "number"
                                  ? prevDraft.progress
                                  : typeof item.progress === "number"
                                  ? item.progress
                                  : 0,
                              note: value,
                            },
                          };
                        });
                      }}
                      rows={3}
                      placeholder="e.g. Completed Unit 2 repertoire, ready to start arpeggios."
                      style={{
                        padding: "12px",
                        borderRadius: "14px",
                        border: "1px solid rgba(148,163,184,0.5)",
                        fontSize: "13px",
                        resize: "vertical",
                        backgroundColor: "#f8fafc",
                        color: "#0f172a",
                      }}
                    />
                  </label>

                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => handleSaveProgress(item)}
                      style={{
                        padding: "12px 16px",
                        borderRadius: "12px",
                        border: "none",
                        background: "linear-gradient(120deg, #2563eb, #1d4ed8)",
                        color: "white",
                        fontWeight: 700,
                        cursor: "pointer",
                        boxShadow: "0 14px 30px rgba(37,99,235,0.2)",
                      }}
                    >
                      Save progress
                    </button>
                    <p style={{ fontSize: "11px", color: "#94a3b8" }}>
                      {lastUpdated ? `Last updated ${lastUpdated}` : "No instructor updates yet."}
                    </p>
                  </div>
                </article>
              );
            })
          )}
        </section>

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
          {filteredLogs.length === 0 ? (
            <p style={{ fontSize: "14px", color: "#475569" }}>No practice submissions match the filters.</p>
          ) : (
            groupedLogs.map(([courseTitle, entries]) => (
              <div key={courseTitle} style={{ display: "grid", gap: "12px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    backgroundColor: "rgba(248,250,252,0.9)",
                    borderRadius: "12px",
                    padding: "10px 14px",
                    border: "1px solid rgba(226,232,240,0.7)",
                    cursor: "pointer",
                  }}
                  onClick={() => toggleGroup(courseTitle)}
                >
                  <strong style={{ color: "#0f172a", fontSize: "14px" }}>{courseTitle}</strong>
                  <span style={{ fontSize: "12px", color: "#475569", display: "flex", alignItems: "center", gap: "8px" }}>
                    {entries.length} submissions
                    <span style={{ fontSize: "14px" }}>{collapsedGroups[courseTitle] ? "▸" : "▾"}</span>
                  </span>
                </div>

                {!collapsedGroups[courseTitle] &&
                  entries.map((entry) => {
                    const status = entry.status || "pending";
                    const statusStyles =
                      status === "reviewed"
                        ? { bg: "rgba(34,197,94,0.15)", color: "#15803d" }
                        : status === "attention"
                      ? { bg: "rgba(248,113,113,0.15)", color: "#b91c1c" }
                      : { bg: "rgba(251,191,36,0.18)", color: "#92400e" };
                  const isAttention = status === "attention";

                  return (
                    <article
                      key={entry.id}
                      style={{
                        borderRadius: "16px",
                        border: isAttention ? "1px solid rgba(248,113,113,0.5)" : "1px solid rgba(226,232,240,0.9)",
                        padding: "16px",
                        backgroundColor: "white",
                        boxShadow: isAttention
                          ? "0 12px 28px rgba(248,113,113,0.2)"
                          : "0 12px 28px rgba(15,23,42,0.06)",
                        display: "grid",
                        gap: "10px",
                      }}
                    >
                      <header
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "12px",
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <p style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                            {entry.studentName} · {entry.studentEmail}
                          </p>
                          <p style={{ fontSize: "12px", color: "#475569", margin: "4px 0 0" }}>
                            {entry.courseTitle} {entry.courseLevel ? `(${entry.courseLevel})` : ""} · {entry.minutes} min ·{" "}
                            {new Date(entry.date || entry.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <select
                          value={status}
                          onChange={(event) => handleStatusChange(entry.id, event.target.value)}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "999px",
                            border: "1px solid rgba(148,163,184,0.45)",
                            fontSize: "12px",
                            backgroundColor: statusStyles.bg,
                            color: statusStyles.color,
                            fontWeight: 800,
                            minWidth: "150px",
                            textAlign: "center",
                          }}
                        >
                          <option value="pending">Pending review</option>
                          <option value="reviewed">Reviewed</option>
                          <option value="attention">Needs attention</option>
                        </select>
                      </header>

                      {entry.note && (
                        <p style={{ fontSize: "13px", color: "#0f172a", margin: 0 }}>
                          Student focus: <span style={{ color: "#475569" }}>{entry.note}</span>
                        </p>
                      )}

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          flexWrap: "wrap",
                        }}
                      >
                        {entry.mediaUrl && (
                          <a
                            href={entry.mediaUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "8px 12px",
                              borderRadius: "10px",
                              border: "1px solid rgba(148,163,184,0.5)",
                              backgroundColor: "rgba(248,250,252,0.9)",
                              color: "#2563eb",
                              fontWeight: 700,
                              textDecoration: "none",
                              fontSize: "12px",
                              flexShrink: 0,
                            }}
                          >
                            {entry.mediaType?.startsWith("video") ? "▶️ Watch" : "🎧 Listen"}
                            <span style={{ color: "#475569", fontWeight: 600 }}>
                              {entry.mediaName ? `(${entry.mediaName})` : "submission"}
                            </span>
                          </a>
                        )}
                        <p style={{ fontSize: "11px", color: "#94a3b8", margin: 0 }}>
                          <span>Submission: {entry.id || "N/A"}</span>
                          {entry.mediaDuration ? ` · Duration: ${entry.mediaDuration}` : ""}
                          {entry.mediaSize
                            ? ` · Size: ${
                                entry.mediaSize > 1024 * 1024
                                  ? `${(entry.mediaSize / (1024 * 1024)).toFixed(1)} MB`
                                  : `${Math.ceil(entry.mediaSize / 1024)} KB`
                              }`
                            : ""}
                        </p>
                      </div>

                      <label style={{ display: "grid", gap: "6px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>Feedback</span>
                        <textarea
                          value={feedbackDrafts[entry.id] ?? entry.feedback ?? ""}
                          onChange={(event) =>
                            setFeedbackDrafts((prev) => ({ ...prev, [entry.id]: event.target.value }))
                          }
                          rows={3}
                          placeholder="Share coaching notes, next assignments, or encouragement."
                          style={{
                            padding: "12px",
                            borderRadius: "12px",
                            border: "1px solid rgba(148,163,184,0.5)",
                            fontSize: "13px",
                            resize: "vertical",
                            backgroundColor: "#f8fafc",
                            color: "#0f172a",
                          }}
                        />
                      </label>

                      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => handleSaveFeedback(entry.id)}
                          style={{
                            padding: "10px 16px",
                            borderRadius: "12px",
                            border: "none",
                            background: "linear-gradient(120deg, #2563eb, #1d4ed8)",
                            color: "white",
                            fontWeight: 700,
                            cursor: "pointer",
                            boxShadow: "0 12px 26px rgba(37,99,235,0.2)",
                          }}
                        >
                          Send feedback
                        </button>
                        <p style={{ fontSize: "11px", color: "#94a3b8", margin: 0 }}>
                          {entry.feedback
                            ? `Last updated ${new Date(entry.feedbackUpdatedAt || entry.createdAt).toLocaleString()}`
                            : "No feedback yet."}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
            ))
          )}
        </section>
          </div>

          <aside
            style={{
              display: "grid",
              gap: "12px",
              position: "sticky",
              top: "24px",
            }}
          >
            <div
              style={{
                borderRadius: "16px",
                border: "1px solid rgba(226,232,240,0.8)",
                padding: "14px",
                backgroundColor: "white",
                boxShadow: "0 12px 24px rgba(15,23,42,0.08)",
                display: "grid",
                gap: "10px",
              }}
            >
              <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>Review summary</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "8px" }}>
                <div style={{ padding: "8px 10px", borderRadius: "10px", backgroundColor: "rgba(59,130,246,0.08)" }}>
                  <p style={{ margin: 0, fontSize: "11px", color: "#2563eb", fontWeight: 700 }}>Pending</p>
                  <p style={{ margin: "4px 0 0", fontSize: "18px", color: "#0f172a", fontWeight: 800 }}>{statusCounts.pending}</p>
                </div>
                <div style={{ padding: "8px 10px", borderRadius: "10px", backgroundColor: "rgba(34,197,94,0.08)" }}>
                  <p style={{ margin: 0, fontSize: "11px", color: "#15803d", fontWeight: 700 }}>Reviewed</p>
                  <p style={{ margin: "4px 0 0", fontSize: "18px", color: "#0f172a", fontWeight: 800 }}>{statusCounts.reviewed}</p>
                </div>
                <div style={{ padding: "8px 10px", borderRadius: "10px", backgroundColor: "rgba(248,113,113,0.08)" }}>
                  <p style={{ margin: 0, fontSize: "11px", color: "#b91c1c", fontWeight: 700 }}>Needs attention</p>
                  <p style={{ margin: "4px 0 0", fontSize: "18px", color: "#0f172a", fontWeight: 800 }}>{statusCounts.attention}</p>
                </div>
              </div>
              <div
                style={{
                  padding: "10px",
                  borderRadius: "12px",
                  backgroundColor: "rgba(248,250,252,0.9)",
                  border: "1px dashed rgba(148,163,184,0.4)",
                }}
              >
                <p style={{ margin: 0, fontSize: "12px", color: "#475569" }}>Average progress</p>
                <p style={{ margin: "2px 0 0", fontSize: "22px", fontWeight: 800, color: "#0f172a" }}>
                  {averageProgress}%
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
