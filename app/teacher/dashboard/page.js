"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {addDoc,collection,deleteDoc,doc,onSnapshot,orderBy,query,serverTimestamp,updateDoc,} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { signOut } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";
import { courseCatalog } from "@/lib/courseCatalog";

const RESOURCE_TYPES = [
  { value: "video", label: "Video" },
  { value: "sheet", label: "Sheet Music" },
  { value: "assignment", label: "Assignment" },
  { value: "link", label: "External Link" },
];

const TYPE_ICONS = {
  video: "🎬",
  sheet: "🎼",
  assignment: "📝",
  link: "🔗",
};

export default function TeacherDashboardPage() {
  
  const router = useRouter();
  const { sessionUser, loading } = useSessionUser();
  const [materials, setMaterials] = useState([]);

  const summary = useMemo(() => {
  const total = materials.length;
  const assignments = materials.filter((item) => item.type === "assignment").length;
  const videos = materials.filter((item) => item.type === "video").length;
  const lastUpdated =materials.length > 0
        ? materials
            .map((item) => new Date(item.createdAt || item.updatedAt || 0).getTime())
            .filter((time) => Number.isFinite(time))
            .sort((a, b) => b - a)[0]
        : null;
    return {
      totalResources: total,
      assignmentCount: assignments,
      videoCount: videos,
      lastUpdated: lastUpdated ? new Date(lastUpdated).toLocaleString() : "N/A",
    };
  }, [materials]);

  const [courseId, setCourseId] = useState(courseCatalog[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [type, setType] = useState(RESOURCE_TYPES[0]?.value ?? "video");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [visibleToStudents, setVisibleToStudents] = useState(true);
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

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

  //read-time material
  useEffect(() => {
    if (!sessionUser) return;

    const materialsRef = collection(db, "materials");
    const materialsQuery = query(materialsRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      materialsQuery,
      (snapshot) => {
        const nextMaterials = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate()
              : data.createdAt ?? null;
          const updatedAt =
            data.updatedAt && typeof data.updatedAt.toDate === "function"
              ? data.updatedAt.toDate()
              : data.updatedAt ?? null;

          return {
            id: docSnapshot.id,
            ...data,
            createdAt,
            updatedAt,
          };
        });

        setMaterials(nextMaterials);
      },
      (error) => {
        console.error("Failed to subscribe to teaching materials", error);
      }
    );

    return () => unsubscribe();
  }, [sessionUser]);

  function resetForm() {
    setTitle("");
    setDescription("");
    setUrl("");
    setVisibleToStudents(true);
    setFile(null);
    setIsUploading(false);
  }
//update materials
  async function handleSubmit(event) {
    event.preventDefault();

    if (!courseId || !title.trim()) {
      alert("Please choose a course and enter a title.");
      return;
    }

    let finalUrl = url.trim();
    const originalFileName = file?.name ?? null;

    setIsUploading(true);

    try {
      if (file) {
        const storageRef = ref(
          storage,
          "teacher-resources/" + courseId + "/" + Date.now() + "-" + file.name
        );
        await uploadBytes(storageRef, file);
        finalUrl = await getDownloadURL(storageRef);
      }

      const payload = {
        courseId,
        title: title.trim(),
        type,
        description: description.trim(),
        url: finalUrl,
        visibleToStudents,
        source: file ? "uploaded" : "link",
        originalFileName,
        ownerUid: sessionUser?.uid ?? null,
        ownerEmail: sessionUser?.email ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await addDoc(collection(db, "materials"), payload);
      resetForm();
    } catch (error) {
      console.error("Failed to save resource", error);
      alert("Failed to save resource. Please try again.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Failed to sign out", error);
    } finally {
      router.push("/login");
    }
  }

  if (loading || !sessionUser || sessionUser.role !== "teacher") return null;

  const teacherDisplayName =sessionUser?.displayName || sessionUser?.name || sessionUser?.email || "Teacher";
  const teacherInitial = teacherDisplayName.slice(0, 1).toUpperCase();
  const teacherEmail = sessionUser?.email ?? "";
  const firstName = teacherDisplayName.split(" ")[0] || teacherDisplayName;

  const sidebarStats = [
    { label: "Resources", value: summary.totalResources },
    { label: "Assignments", value: summary.assignmentCount },
    { label: "Videos", value: summary.videoCount },
  ];

  const heroStats = [
    { label: "Total resources", value: summary.totalResources },
    { label: "Assignments", value: summary.assignmentCount },
    { label: "Video lessons", value: summary.videoCount },
    { label: "Last update", value: summary.lastUpdated },
  ];

  const navLinks = [
    { label: "Upload resource", href: "#upload", anchor: true, icon: "🗂️", description: "Add new course materials" },
    { label: "Practice logs", href: "/teacher/practice-logs", icon: "🎧", description: "Review student sessions" },
    { label: "Schedule & attendance", href: "/teacher/schedule", icon: "🗓️", description: "Manage lesson times" },
    { label: "Resources", href: "/teacher/resources", icon: "📚", description: "Go to library" },
  ];

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #eef2ff 0%, #e0f2fe 45%, #f8fafc 100%)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        padding: "48px 24px",
      }}
    >
      <div
        style={{
          maxWidth: "1260px",
          margin: "0 auto",
          display: "grid",
          rowGap: "24px",
          columnGap: "64px",
          gridTemplateColumns: "340px minmax(0, 1fr)",
          alignItems: "start",
        }}
      >
        <aside
          style={{
            borderRadius: "32px",
            background: "linear-gradient(180deg, #f1f5ff, #ffffff)",
            color: "#0f172a",
            padding: "24px",
            boxShadow: "0 30px 65px rgba(15,23,42,0.22)",
            display: "grid",
            gap: "18px",
            position: "sticky",
            top: "24px",
            height: "fit-content",
            zIndex: 2,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "16px",
                background: "linear-gradient(135deg, #e0f2fe, #a5f3fc)",
                color: "#0f172a",
                fontSize: "26px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 18px 40px rgba(148,163,184,0.35)",
              }}
            >
              {teacherInitial}
            </div>
            <div>
              <p style={{ margin: 0, fontSize: "12px", letterSpacing: "0.18em", color: "#2563eb" }}>TEACHER</p>
              <h2 style={{ margin: "6px 0 2px", fontSize: "20px", color: "#0f172a" }}>{teacherDisplayName}</h2>
             
            </div>
          </div>

         <div style={{ display: "grid", gap: "8px" }}>
            {navLinks.map((link) => {
              const CardTag = link.anchor ? "a" : Link;
              return (
                <CardTag
                  key={link.label}
                  href={link.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 16px",
                    borderRadius: "14px",
                    border: "1px solid rgba(148,163,184,0.15)",
                    backgroundColor: "white",
                    color: "#0f172a",
                    textDecoration: "none",
                    boxShadow: "0 8px 18px rgba(148,163,184,0.14)",
                    width: "calc(100% - 16px)",
                    margin: "0 auto",
                    boxSizing: "border-box",
                  }}
                >
                  <span style={{ fontSize: "16px" }}>{link.icon}</span>
                  <div style={{ flex: 1 }}>
                    <strong style={{ display: "block", fontSize: "13px" }}>{link.label}</strong>
                    <span style={{ fontSize: "12px", color: "#94a3b8", display: "block" }}>
                      {link.description}
                    </span>
                  </div>
                  <span aria-hidden="true" style={{ color: "#cbd5f5", fontSize: "12px" }}>
                    
                  </span>
                </CardTag>
              );
            })}
          </div>

          <div
            style={{
              display: "grid",
              gap: "12px",
              borderTop: "1px solid rgba(148,163,184,0.25)",
              paddingTop: "18px",
            }}
          >
            <p style={{ fontSize: "12px", letterSpacing: "0.12em", color: "#94a3b8" }}>QUICK STATS</p>
            <div style={{ display: "grid", gap: "12px" }}>
              {sidebarStats.map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    borderRadius: "14px",
                    padding: "12px 18px",
                    backgroundColor: "rgba(255,255,255,0.9)",
                    border: "1px solid rgba(148,163,184,0.25)",
                    display: "grid",
                    gridTemplateColumns: "auto auto",
                    alignItems: "center",
                    boxShadow: "0 8px 20px rgba(148,163,184,0.18)",
                    width: "calc(100% - 16px)",
                    margin: "0 auto",
                  }}
                >
                  <span style={{ fontSize: "13px", color: "#475569" }}>{stat.label}</span>
                  <strong style={{ justifySelf: "end", color: "#0f172a", fontSize: "18px" }}>
                    {stat.value}
                  </strong>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleLogout}
            style={{
              marginTop: "8px",
              padding: "12px 18px",
              borderRadius: "14px",
              border: "none",
              background: "linear-gradient(120deg, #f87171, #ef4444)",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 16px 40px rgba(239,68,68,0.25)",
              width: "100%",
            }}
          >
            Log out
          </button>
        </aside>
        <div style={{ display: "grid", gap: "24px", paddingLeft: "24px" }}>
          <section
            style={{
              borderRadius: "28px",
              padding: "28px",
              background: "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(59,130,246,0.8))",
              color: "white",
              boxShadow: "0 18px 45px rgba(15,23,42,0.2)",
              border: "1px solid rgba(148,163,184,0.2)",
              display: "grid",
              gap: "24px",
              position: "relative",
              overflow: "hidden",
              marginLeft: "24px",
            }}
          >
            <div style={{ display: "grid", gap: "10px" }}>
              <p style={{ fontSize: "12px", letterSpacing: "0.18em", margin: 0, color: "#a5f3fc" }}>
                RESOURCE COMMAND CENTER
              </p>
              <h1 style={{ margin: 0, fontSize: "30px" }}>Welcome back, {firstName}!</h1>
              <p style={{ margin: 0, fontSize: "14px", color: "rgba(226,232,240,0.85)" }}>
                Plan lessons, upload assignments, and keep every course stocked with updated materials.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "12px" }}>
                <a
                  href="#upload"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "12px 20px",
                    borderRadius: "999px",
                    border: "1px solid rgba(255,255,255,0.4)",
                    backgroundColor: "rgba(14,165,233,0.2)",
                    color: "white",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Upload new resource
                </a>
                <Link
                  href="/teacher/practice-logs"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "12px 20px",
                    borderRadius: "999px",
                    border: "1px solid rgba(255,255,255,0.25)",
                    backgroundColor: "rgba(15,23,42,0.4)",
                    color: "white",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Review practice logs
                </Link>
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gap: "12px",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              }}
            >
              {heroStats.map((stat, index) => (
                <SummaryCard
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  accent={index !== heroStats.length - 1}
                />
              ))}
            </div>
          </section>
          <section
            id="upload"
            style={{
              borderRadius: "28px",
              border: "1px solid rgba(203,213,225,0.6)",
              backgroundColor: "white",
              boxShadow: "0 25px 55px rgba(15,23,42,0.12)",
              padding: "28px",
              display: "grid",
              gap: "18px",
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: "12px", letterSpacing: "0.12em", color: "#2563eb" }}>
                RESOURCE UPLOAD
              </p>
              <h2 style={{ marginTop: "6px", fontSize: "22px", color: "#0f172a" }}>
                Upload a new resource
              </h2>
              <p style={{ marginTop: "4px", fontSize: "13px", color: "#475569" }}>
                Attach media, describe how students should use it, and publish when ready.
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: "grid", gap: "16px" }}>
              <label style={{ display: "grid", gap: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                  Course
                </span>
                <select
                  value={courseId}
                  onChange={(event) => setCourseId(event.target.value)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: "14px",
                    border: "1px solid rgba(148,163,184,0.6)",
                    backgroundColor: "#f8fafc",
                    color: "#0f172a",
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

              <div
                style={{
                  display: "grid",
                  gap: "16px",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                }}
              >
                <label style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                    Title
                  </span>
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Resource title"
                    style={{
                      padding: "12px 14px",
                      borderRadius: "14px",
                      border: "1px solid rgba(148,163,184,0.6)",
                      backgroundColor: "#f8fafc",
                      color: "#0f172a",
                      fontSize: "14px",
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                    Type
                  </span>
                  <select
                    value={type}
                    onChange={(event) => setType(event.target.value)}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "14px",
                      border: "1px solid rgba(148,163,184,0.6)",
                      backgroundColor: "#f8fafc",
                      color: "#0f172a",
                      fontSize: "14px",
                    }}
                  >
                    {RESOURCE_TYPES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label style={{ display: "grid", gap: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                  Description
                </span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  placeholder="Short notes about how students should use this resource"
                  style={{
                    padding: "12px",
                    borderRadius: "14px",
                    border: "1px solid rgba(148,163,184,0.6)",
                    backgroundColor: "#f8fafc",
                    color: "#0f172a",
                    fontSize: "14px",
                    resize: "vertical",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                  Link / file URL
                </span>
                <input
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://..."
                  style={{
                    padding: "12px 14px",
                    borderRadius: "14px",
                    border: "1px solid rgba(148,163,184,0.6)",
                    backgroundColor: "#f8fafc",
                    color: "#0f172a",
                    fontSize: "14px",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                  Upload file (optional)
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <label
                    htmlFor="fileUpload"
                    style={{
                      display: "inline-block",
                      background: "linear-gradient(120deg, #2563eb, #1d4ed8)",
                      color: "white",
                      padding: "10px 16px",
                      borderRadius: "10px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Choose File
                  </label>
                  <span style={{ color: "#475569", fontSize: "14px" }}>
                    {file ? file.name : "No file chosen"}
                  </span>

                  <input
                    id="fileUpload"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.mp3,.mp4"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    style={{ display: "none" }}
                  />
                </div>

                <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                  Uploading will store the file in Firebase Storage and auto-fill the URL.
                </span>
              </label>

              <label style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={visibleToStudents}
                  onChange={(event) => setVisibleToStudents(event.target.checked)}
                />
                <span style={{ fontSize: "13px", color: "#0f172a" }}>Visible to students</span>
              </label>

              <button
                type="submit"
                disabled={isUploading}
                style={{
                  padding: "14px 18px",
                  borderRadius: "14px",
                  border: "none",
                  background: isUploading
                    ? "linear-gradient(120deg, #94a3b8, #64748b)"
                    : "linear-gradient(120deg, #2563eb, #1d4ed8)",
                  color: "white",
                  fontWeight: 600,
                  cursor: isUploading ? "not-allowed" : "pointer",
                  boxShadow: "0 18px 40px rgba(37,99,235,0.25)",
                }}
              >
                {isUploading ? "Uploading..." : "Save resource"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}

function SummaryCard({ label, value, accent = true }) {
  const palette = accent
    ? { background: "rgba(255,255,255,0.12)", color: "#f8fafc" }
    : { background: "rgba(15,23,42,0.25)", color: "#cbd5f5" };
  return (
    <div
      style={{
        borderRadius: "16px",
        padding: "14px 16px",
        backgroundColor: palette.background,
        backdropFilter: "blur(4px)",
        border: "1px solid rgba(255,255,255,0.18)",
        display: "grid",
        gap: "6px",
      }}
    >
      <span
        style={{
          fontSize: "12px",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "rgba(248,250,252,0.72)",
        }}
      >
        {label}
      </span>
      <strong style={{ fontSize: "20px", fontWeight: 700, color: palette.color }}>{value}</strong>
    </div>
  );
}