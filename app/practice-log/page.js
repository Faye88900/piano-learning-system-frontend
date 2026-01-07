"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import {addDoc,collection,deleteDoc,doc,onSnapshot,orderBy,query,serverTimestamp,where,} from "firebase/firestore";
import { courseCatalog } from "@/lib/courseCatalog";
import { db, storage } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";

export default function PracticeLogPage() {

  const router = useRouter();
  const { sessionUser, loading } = useSessionUser();
  const [enrollments, setEnrollments] = useState([]);
  const [practiceLogsByCourse, setPracticeLogsByCourse] = useState({});

  useEffect(() => {
    if (loading) return;
    if (!sessionUser) {
      router.push("/login");
      return;
    }
    if (sessionUser.role !== "student") {
      router.push("/Dashboard");
    }
  }, [sessionUser, loading, router]);

   //当前学生报名了哪些课程
  useEffect(() => {
    if (!sessionUser?.uid) return;

    const enrollmentsQuery = query(
      collection(db, "enrollments"),
      where("studentUid", "==", sessionUser.uid)
    );

    const unsubscribe = onSnapshot(
      enrollmentsQuery,
      (snapshot) => {
        const nextEnrollments = snapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data();
            return {
              id: data.courseId ?? data.id,
              docId: docSnapshot.id,
              ...data,
            };
          })
          .filter((item) => Boolean(item.id));
        setEnrollments(nextEnrollments);
      },
      (error) => {
        console.error("Failed to load enrollments", error);
        setEnrollments([]);
      }
    );

    return () => unsubscribe();
  }, [sessionUser?.uid]);

  //practicelogs
  useEffect(() => {
    if (!sessionUser?.uid) return;

    const logsQuery = query(
      collection(db, "practiceLogs"),
      where("studentUid", "==", sessionUser.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        const grouped = {};
        snapshot.forEach((docSnapshot) => {
          const data = docSnapshot.data();
          const courseId = data.courseId;
          if (!courseId) return;

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

          const entry = {
            id: docSnapshot.id,
            ...data,
            createdAt,
            updatedAt,
            feedbackUpdatedAt,
          };
          if (!grouped[courseId]) grouped[courseId] = [];
          grouped[courseId].push(entry);
        });

        for (const key of Object.keys(grouped)) {
          grouped[key].sort((a, b) => {
            const dateDiff =
              new Date(`${b.date || ""}T00:00:00`).getTime() -
              new Date(`${a.date || ""}T00:00:00`).getTime();
            if (dateDiff !== 0) return dateDiff;
            return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
          });
        }

        setPracticeLogsByCourse(grouped);
      },
      (error) => {
        console.error("Failed to subscribe to practice logs", error);
        setPracticeLogsByCourse({});
      }
    );

    return () => unsubscribe();
  }, [sessionUser?.uid]);

  //course map
  const courseById = useMemo(() => {
    const map = {};
    for (const course of courseCatalog) {
      map[course.id] = course;
    }
    return map;
  }, []);

  //合并
  const enrichedCourses = useMemo(() => {
    if (!enrollments.length) return [];
    return enrollments
      .map((entry) => {
        const course = courseCatalog.find((item) => item.id === entry.id);
        if (!course) return null;
        return {
          ...course,
          enrollment: entry,
        };
      })
      .filter(Boolean);
  }, [enrollments]);

  async function handleAddPracticeEntry(courseId, payload) {
    if (!courseId || !sessionUser?.uid) return;

    const minutes = Math.max(0, Number(payload.minutes) || 0);
    if (!minutes) {
      return;
    }

    const newEntry = {
      date: payload.date || new Date().toISOString().slice(0, 10),
      minutes,
      note: payload.note?.trim() || "",
      mediaUrl: payload.mediaUrl || null,
      mediaType: payload.mediaType || null,
      mediaName: payload.mediaName || null,
    };

      try {
        await addDoc(collection(db, "practiceLogs"), {
          courseId,
          courseTitle: courseById[courseId]?.title ?? "",
          studentUid: sessionUser.uid,
          studentEmail: sessionUser.email ?? "",
          ...newEntry,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        console.error("Failed to add practice log", error);
        alert("Unable to log practice right now. Please try again.");
      }
    }

  function handleDeletePracticeEntry(courseId, entryId) {
    if (!courseId || !entryId) return;
    deleteDoc(doc(db, "practiceLogs", entryId)).catch((error) => {
      console.error("Failed to delete practice log", error);
      alert("Unable to delete this entry right now. Please try again.");
    });
  }

  if (loading || !sessionUser || sessionUser.role !== "student") {
    return null;
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, #eff6ff 0%, #e0f2fe 35%, #f8fafc 100%)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        padding: "48px 24px",
      }}
    >
      <section
        style={{
          maxWidth: "960px",
          margin: "0 auto",
          borderRadius: "32px",
          backgroundColor: "rgba(255,255,255,0.95)",
          boxShadow: "0 28px 60px rgba(15, 23, 42, 0.18)",
          border: "1px solid rgba(226,232,240,0.6)",
          padding: "40px",
          display: "grid",
          gap: "24px",
        }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
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
              PRACTICE LOG
            </p>
            <h1
              style={{
                marginTop: "18px",
                fontSize: "32px",
                fontWeight: 700,
                color: "#0f172a",
              }}
            >
              Practice Log Workspace
            </h1>
            <p style={{ marginTop: "8px", color: "#475569", fontSize: "14px" }}>
              Capture your daily piano practice minutes and focus areas to stay on pace.
            </p>
          </div>
          <Link
            href="/Dashboard"
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
            ← Back to Dashboard
          </Link>
        </header>

        <PracticeLogPanel
          enrolledCourses={enrichedCourses}
          practiceLogs={practiceLogsByCourse}
          onAddEntry={handleAddPracticeEntry}
          onDeleteEntry={handleDeletePracticeEntry}
          sessionUser={sessionUser}
        />
      </section>
    </main>
  );
}

function PracticeLogPanel({
  enrolledCourses,
  practiceLogs,
  onAddEntry,
  onDeleteEntry,
  sessionUser,
}) {
  const [selectedCourseId, setSelectedCourseId] = useState(enrolledCourses[0]?.id ?? "");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  const formRef = useRef(null);

  useEffect(() => {
    if (!enrolledCourses.length) {
      if (selectedCourseId) {
        setSelectedCourseId("");
      }
      return;
    }
//找对应的课程 没有就自动到第一个课程
    const stillValid = enrolledCourses.some((course) => course.id === selectedCourseId);
    if (!selectedCourseId || !stillValid) {
      setSelectedCourseId(enrolledCourses[0].id);
    }
  }, [enrolledCourses, selectedCourseId]);

  if (!enrolledCourses.length) {
    return (
      <p style={{ marginTop: "14px", fontSize: "13px", color: "#475569" }}>
        Enroll in a course to start logging your practice minutes.
      </p>
    );
  }

  const selectedCourse = enrolledCourses.find((course) => course.id === selectedCourseId);
  const courseLogs =selectedCourseId && practiceLogs[selectedCourseId] ? practiceLogs[selectedCourseId] : [];
  const displayLogs = courseLogs;

  const resolveEntryDate = (entry) => {
    if (!entry) return null;
    return entry.date
      ? new Date(`${entry.date}T00:00:00`)
      : new Date(entry.createdAt || "");
  };

  const formatEntryDateLabel = (entry) => {
    const entryDate = resolveEntryDate(entry);
    if (!entryDate || Number.isNaN(entryDate.getTime())) {
      return entry ? "Unknown date" : "No entries yet";
    }
    return entryDate.toLocaleDateString();
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const MS_IN_DAY = 1000 * 60 * 60 * 24;

  const minutesThisWeek = courseLogs.reduce((total, entry) => {
    const entryDate = resolveEntryDate(entry);
    if (!entryDate || Number.isNaN(entryDate.getTime())) {
      return total;
    }
    const normalized = new Date(entryDate);
    normalized.setHours(0, 0, 0, 0);
    const diffDays = Math.abs(Math.floor((normalized - today) / MS_IN_DAY));
    if (diffDays <= 7) {
      return total + (Number(entry.minutes) || 0);
    }
    return total;
  }, 0);

  const practiceStats = [
    { label: "Minutes (7 days)", value: `${minutesThisWeek}` },
    { label: "Entries logged", value: courseLogs.length },
    { label: "Last entry", value: formatEntryDateLabel(courseLogs[0]) },
  ];

  const heroStats = [
    { label: "Current course", value: selectedCourse?.title || "Select a course" },
    { label: "Minutes logged", value: `${minutesThisWeek}` },
    { label: "Total entries", value: `${courseLogs.length}` },
  ];

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isUploading) return;
    if (!selectedCourseId) {
      alert("Please select a course");
      return;
    }
    const numericMinutes = Number(minutes);
    if (!numericMinutes || numericMinutes <= 0) {
      alert("Please enter the number of minutes you practiced");
      return;
    }

    let mediaUrl = null;
    let mediaType = null;
    let mediaName = null;

    if (file) {
      if (!sessionUser?.uid) {
        alert("Please log in again before uploading files.");
        return;
      }
      try {
        setIsUploading(true);
        const storageRef = ref(
          storage,
          `practice-logs/${sessionUser.uid}/${selectedCourseId || "course"}-${Date.now()}-${file.name}`
        );
        await uploadBytes(storageRef, file);
        mediaUrl = await getDownloadURL(storageRef);
        mediaType = file.type || null;
        mediaName = file.name || null;
      } catch (error) {
        console.error("Failed to upload practice media", error);
        alert("Upload failed. Please try again.");
        setIsUploading(false);
        return;
      }
    }
//写回去hanladdpracticeEntry
    await onAddEntry(selectedCourseId, {
      minutes: numericMinutes,
      note,
      date,
      mediaUrl,
      mediaType,
      mediaName,
    });

    setMinutes("");
    setNote("");
    setDate(new Date().toISOString().slice(0, 10));
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setIsUploading(false);
  };

  return (
    <div style={{ display: "grid", gap: "24px" }}>
      <section
        style={{
          borderRadius: "28px",
          padding: "28px",
          background: "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,64,175,0.85))",
          color: "white",
          boxShadow: "0 28px 60px rgba(15,23,42,0.45)",
          display: "grid",
          gap: "18px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: "12px", letterSpacing: "0.18em", color: "rgba(255,255,255,0.6)", margin: 0 }}>
              PRACTICE SUMMARY
            </p>
            <h2 style={{ marginTop: "8px", fontSize: "26px", fontWeight: 700 }}>
              Keep your practice streak going
            </h2>
            <p style={{ marginTop: "6px", fontSize: "14px", color: "rgba(255,255,255,0.85)" }}>
              Log focused sessions, upload clips, and review instructor feedback in one place.
            </p>
          </div>
          <button
            type="button"
            onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            style={{
              alignSelf: "flex-start",
              padding: "12px 22px",
              borderRadius: "999px",
              border: "none",
              background: "white",
              color: "#0f172a",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 12px 30px rgba(15,23,42,0.35)",
            }}
          >
            Log a new session
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "12px",
          }}
        >
          {heroStats.map((stat) => (
            <div
              key={stat.label}
              style={{
                borderRadius: "18px",
                backgroundColor: "rgba(255,255,255,0.14)",
                border: "1px solid rgba(255,255,255,0.25)",
                padding: "12px 16px",
                display: "grid",
                gap: "4px",
              }}
            >
              <span style={{ fontSize: "11px", letterSpacing: "0.08em", color: "rgba(255,255,255,0.78)" }}>
                {stat.label}
              </span>
              <strong style={{ fontSize: "18px", color: "white" }}>{stat.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <div
        style={{
          display: "grid",
          gap: "24px",
          gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)",
          alignItems: "stretch",
        }}
      >
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          style={{
            borderRadius: "24px",
            border: "1px solid rgba(206,217,232,0.8)",
            boxShadow: "0 22px 45px rgba(15,23,42,0.08)",
            padding: "24px",
            backgroundColor: "white",
            display: "grid",
            gap: "18px",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "20px", color: "#0f172a" }}>Log practice minutes</h3>
            <p style={{ marginTop: "4px", fontSize: "13px", color: "#64748b" }}>
              Select a course, add minutes and notes, then attach optional clips.
            </p>
          </div>

          <label style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a", display: "grid", gap: "6px" }}>
            Course
            <select
              value={selectedCourseId}
              onChange={(event) => setSelectedCourseId(event.target.value)}
              style={{
                padding: "12px",
                borderRadius: "14px",
                border: "1px solid rgba(148,163,184,0.4)",
                fontSize: "14px",
                backgroundColor: "#f8fafc",
                color: "#0f172a",
              }}
            >
              {enrolledCourses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>

          <div
            style={{
              display: "grid",
              gap: "12px",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            }}
          >
            <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
              Date
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                style={{
                  padding: "12px",
                  borderRadius: "14px",
                  border: "1px solid rgba(148,163,184,0.4)",
                  fontSize: "14px",
                  backgroundColor: "#f8fafc",
                  color: "#0f172a",
                }}
              />
            </label>

            <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
              Minutes
              <input
                type="number"
                min="1"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                placeholder="e.g. 45"
                style={{
                  padding: "12px",
                  borderRadius: "14px",
                  border: "1px solid rgba(148,163,184,0.4)",
                  fontSize: "14px",
                  backgroundColor: "#f8fafc",
                  color: "#0f172a",
                }}
              />
            </label>
          </div>

          <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
            Focus notes (optional)
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Ex: Scales at 70bpm, reviewed bars 12-20"
              rows={3}
              style={{
                padding: "12px",
                borderRadius: "14px",
                border: "1px solid rgba(148,163,184,0.4)",
                fontSize: "14px",
                resize: "vertical",
                backgroundColor: "#f8fafc",
                color: "#0f172a",
              }}
            />
          </label>

          <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
            Upload clip (optional)
            <div
              style={{
                border: "1px dashed rgba(148,163,184,0.8)",
                borderRadius: "16px",
                padding: "14px",
                backgroundColor: "rgba(248,250,252,0.9)",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/*"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                style={{ fontSize: "13px" }}
              />
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                Accepted formats: audio/video files. Uploading replaces the file for this entry.
              </span>
              {file && <span style={{ fontSize: "12px", color: "#0f172a" }}>{file.name}</span>}
            </div>
          </label>

          <button
            type="submit"
            disabled={isUploading}
            style={{
              padding: "12px 18px",
              borderRadius: "14px",
              border: "none",
              background: isUploading
                ? "linear-gradient(120deg, #94a3b8, #64748b)"
                : "linear-gradient(120deg, #0ea5e9, #0284c7)",
              color: "white",
              fontWeight: 600,
              cursor: isUploading ? "not-allowed" : "pointer",
              boxShadow: "0 16px 30px rgba(37,99,235,0.25)",
            }}
          >
            {isUploading ? "Uploading..." : "Log practice"}
          </button>
        </form>

        <section
          style={{
            borderRadius: "24px",
            border: "1px solid rgba(206,217,232,0.7)",
            padding: "24px",
            backgroundColor: "white",
            boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
            display: "grid",
            gap: "18px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
              borderBottom: "1px solid rgba(226,232,240,0.7)",
              paddingBottom: "12px",
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: "18px", color: "#0f172a" }}>Practice history</h3>
              <p style={{ marginTop: "4px", fontSize: "13px", color: "#64748b" }}>
                {selectedCourse?.title
                  ? `Entries for ${selectedCourse.title}`
                  : "Choose a course to view its entries."}
              </p>
            </div>
            <span style={{ fontSize: "13px", color: "#94a3b8", alignSelf: "center" }}>
              {courseLogs.length ? `${courseLogs.length} total entries` : "No entries recorded"}
            </span>
          </div>

          {displayLogs.length ? (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "16px" }}>
            {displayLogs.map((entry) => (
              <li
                key={entry.id}
                style={{
                  borderRadius: "20px",
                  border: "1px solid rgba(226,232,240,0.9)",
                  padding: "18px",
                  backgroundColor: "#f8fafc",
                  boxShadow: "0 15px 35px rgba(15,23,42,0.06)",
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: "16px",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "grid", gap: "8px" }}>
                  <p style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a", margin: 0 }}>
                    {entry.minutes} min · {formatEntryDateLabel(entry)}
                  </p>
                  {entry.note && (
                    <p style={{ fontSize: "13px", color: "#475569", margin: 0 }}>{entry.note}</p>
                    )}
                    {entry.mediaUrl && (
                      <a
                        href={entry.mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "12px",
                          color: "#0ea5e9",
                          fontWeight: 600,
                          textDecoration: "none",
                        }}
                      >
                        {entry.mediaType?.startsWith("video") ? "Watch video clip" : "Listen to audio"}
                        {entry.mediaName ? ` (${entry.mediaName})` : ""}
                      </a>
                    )}
                    {entry.feedback && (
                      <p
                        style={{
                          fontSize: "12px",
                          color: "#0f172a",
                          margin: 0,
                          padding: "10px 12px",
                          borderRadius: "12px",
                          backgroundColor: "#ecfeff",
                          border: "1px solid rgba(14,165,233,0.3)",
                        }}
                      >
                        <strong style={{ color: "#0284c7" }}>Teacher feedback:</strong> {entry.feedback}
                      </p>
                    )}
                  </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => onDeleteEntry(selectedCourseId, entry.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: "90px",
                      height: "36px",
                      padding: "0 18px",
                      borderRadius: "999px",
                      border: "1px solid rgba(248,113,113,0.65)",
                      backgroundColor: "white",
                      color: "#dc2626",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      boxShadow: "0 8px 16px rgba(220,38,38,0.08)",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          ) : (
            <p style={{ fontSize: "13px", color: "#475569" }}>No practice entries yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}