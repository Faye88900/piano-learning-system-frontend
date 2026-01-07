"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {collection,deleteDoc,doc,onSnapshot,orderBy,query,serverTimestamp,updateDoc,} from "firebase/firestore";
import { courseCatalog } from "@/lib/courseCatalog";
import { db } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";

const TYPE_ICONS = {
  video: "🎬",
  sheet: "🎼",
  assignment: "📝",
  link: "🔗",
};

export default function TeacherResourcesPage() {

  const router = useRouter();
  const { sessionUser, loading } = useSessionUser();
  const [materials, setMaterials] = useState([]);
  const [courseFilter, setCourseFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [expandedCourses, setExpandedCourses] = useState({});
  const [sortKey, setSortKey] = useState("newest"); // newest | oldest | title | type
  const [viewMode, setViewMode] = useState("byCourse"); // byCourse | all
  const [selectedIds, setSelectedIds] = useState([]);

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
          return {
            id: docSnapshot.id,
            ...data,
            createdAt,
          };
        });
        setMaterials(nextMaterials);
      },
      (error) => {
        console.error("Failed to subscribe to materials", error);
      }
    );

    return () => unsubscribe();
  }, [sessionUser]);

  
  //分类课程
  const filteredByCourse = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return courseCatalog
      .filter((course) => courseFilter === "all" || course.id === courseFilter)
      .map((course) => {
        const items = materials
          .filter((item) => item.courseId === course.id)
          .filter((item) => {
            if (visibilityFilter === "published" && !item.visibleToStudents) return false;
            if (visibilityFilter === "hidden" && item.visibleToStudents) return false;
            if (!search) return true;
            const haystack = `${item.title ?? ""} ${item.description ?? ""} ${item.originalFileName ?? ""}`.toLowerCase();
            return haystack.includes(search);
          });
        return { course, items };
      })
      .filter((entry) => {
        if (courseFilter !== "all") return true;
        if (search) return entry.items.length > 0;
        return entry.items.length > 0;
      });
  }, [courseFilter, searchTerm, visibilityFilter, materials]);

  //a-z排列
  const sortItems = useCallback(
    (items) => {
      const cloned = [...items];
      switch (sortKey) {
        case "oldest":
          cloned.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          break;
        case "title":
          cloned.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
          break;
        case "type":
          cloned.sort((a, b) => (a.type || "").localeCompare(b.type || ""));
          break;
        default:
          cloned.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      }
      return cloned;
    },
    [sortKey]
  );

  const flattenedAll = useMemo(() => {
    const rows = [];
    filteredByCourse.forEach(({ course, items }) => {
      sortItems(items).forEach((item) => rows.push({ course, item }));
    });
    return rows;
  }, [filteredByCourse, sortItems]);

 //用来控制课程说明的“展开/收起”状态
  const toggleCourseExpansion = (courseId) => {
    setExpandedCourses((prev) => ({ ...prev, [courseId]: !prev[courseId] }));
  };

  //控制“教材有没有被选中”
  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const clearSelection = () => setSelectedIds([]);

//批量更新
  async function handleBatchVisibility(nextVisible) {
    if (!selectedIds.length) return;
    try {
      await Promise.all(
        selectedIds.map((id) =>
          updateDoc(doc(db, "materials", id), {
            visibleToStudents: nextVisible,
            updatedAt: serverTimestamp(),
          })
        )
      );
      clearSelection();
    } catch (error) {
      console.error("Batch visibility update failed", error);
      alert("Failed to update selected items.");
    }
  }

  async function handleBatchDelete() {
    if (!selectedIds.length) return;
    if (!window.confirm(`Delete ${selectedIds.length} resource(s)?`)) return;
    try {
      await Promise.all(selectedIds.map((id) => deleteDoc(doc(db, "materials", id))));
      clearSelection();
    } catch (error) {
      console.error("Batch delete failed", error);
      alert("Failed to delete selected items.");
    }
  }

  async function handleToggleVisibility(material) {
    try {
      await updateDoc(doc(db, "materials", material.id), {
        visibleToStudents: !material.visibleToStudents,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to update visibility", error);
      alert("Failed to update visibility. Please try again.");
    }
  }

  async function handleDelete(material) {
    if (!window.confirm("Delete this resource?")) return;
    try {
      await deleteDoc(doc(db, "materials", material.id));
    } catch (error) {
      console.error("Failed to delete resource", error);
      alert("Failed to delete resource. Please try again.");
    }
  }

  if (loading || !sessionUser || sessionUser.role !== "teacher") return null;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #eef2ff 0%, #e0f2fe 45%, #f8fafc 100%)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        padding: "32px 20px 48px",
      }}
    >
      <div
        style={{
          maxWidth: "1240px",
          margin: "0 auto",
          display: "grid",
          gap: "18px",
        }}
      >
        <header
          style={{
            borderRadius: "24px",
            padding: "20px 24px",
            backgroundColor: "white",
            boxShadow: "0 18px 40px rgba(15,23,42,0.12)",
            border: "1px solid rgba(226,232,240,0.7)",
            display: "flex",
            justifyContent: "space-between",
            gap: "16px",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: "12px", letterSpacing: "0.16em", color: "#2563eb" }}>
              RESOURCE LIBRARY
            </p>
            <h1 style={{ margin: "6px 0 4px", fontSize: "26px", color: "#0f172a" }}>Course resources</h1>
            <p style={{ margin: 0, fontSize: "13px", color: "#475569" }}>
              Browse, publish, or hide materials by course. Grid view keeps everything tidy.
            </p>
          </div>
          <button
            onClick={() => router.push("/teacher/dashboard")}
            style={{
              padding: "10px 16px",
              borderRadius: "14px",
              border: "1px solid rgba(148,163,184,0.3)",
              background: "white",
              color: "#0f172a",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 10px 20px rgba(148,163,184,0.18)",
            }}
          >
            Back to dashboard
          </button>
        </header>

        <div
          style={{
            display: "grid",
            gap: "14px",
            position: "sticky",
            top: "12px",
            zIndex: 5,
            padding: "10px 12px",
            borderRadius: "18px",
            backgroundColor: "rgba(255,255,255,0.92)",
            boxShadow: "0 12px 28px rgba(15,23,42,0.12)",
            border: "1px solid rgba(226,232,240,0.8)",
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#475569" }}>
              Course
              <select
                value={courseFilter}
                onChange={(event) => setCourseFilter(event.target.value)}
                style={{
                  padding: "8px 10px",
                  borderRadius: "12px",
                  border: "1px solid rgba(148,163,184,0.5)",
                  backgroundColor: "white",
                  fontSize: "13px",
                  color: "#0f172a",
                  minWidth: "160px",
                }}
              >
                <option value="all">All courses</option>
                {courseCatalog.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
            </label>

            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search title, desc, filename..."
              style={{
                flex: "1 1 220px",
                minWidth: "200px",
                padding: "10px 12px",
                borderRadius: "12px",
                border: "1px solid rgba(148,163,184,0.5)",
                backgroundColor: "white",
                fontSize: "13px",
                color: "#0f172a",
              }}
            />

            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#475569" }}>
              Visibility
              <select
                value={visibilityFilter}
                onChange={(event) => setVisibilityFilter(event.target.value)}
                style={{
                  padding: "8px 10px",
                  borderRadius: "12px",
                  border: "1px solid rgba(148,163,184,0.5)",
                  backgroundColor: "white",
                  fontSize: "13px",
                  color: "#0f172a",
                  minWidth: "140px",
                }}
              >
                <option value="all">All</option>
                <option value="published">Visible only</option>
                <option value="hidden">Hidden only</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#475569" }}>
              Sort
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value)}
                style={{
                  padding: "8px 10px",
                  borderRadius: "12px",
                  border: "1px solid rgba(148,163,184,0.5)",
                  backgroundColor: "white",
                  fontSize: "13px",
                  color: "#0f172a",
                  minWidth: "150px",
                }}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="title">Title A→Z</option>
                <option value="type">Type</option>
              </select>
            </label>

            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginLeft: "auto" }}>
              <button
                onClick={() => setViewMode("byCourse")}
                style={{
                  padding: "8px 12px",
                  borderRadius: "12px",
                  border: viewMode === "byCourse" ? "1px solid rgba(59,130,246,0.7)" : "1px solid rgba(148,163,184,0.5)",
                  backgroundColor: viewMode === "byCourse" ? "rgba(59,130,246,0.12)" : "white",
                  color: viewMode === "byCourse" ? "#1d4ed8" : "#0f172a",
                  fontWeight: 700,
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                By course
              </button>
              <button
                onClick={() => setViewMode("all")}
                style={{
                  padding: "8px 12px",
                  borderRadius: "12px",
                  border: viewMode === "all" ? "1px solid rgba(59,130,246,0.7)" : "1px solid rgba(148,163,184,0.5)",
                  backgroundColor: viewMode === "all" ? "rgba(59,130,246,0.12)" : "white",
                  color: viewMode === "all" ? "#1d4ed8" : "#0f172a",
                  fontWeight: 700,
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                All resources
              </button>
            </div>
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px",
              alignItems: "center",
              padding: "10px 14px",
              borderRadius: "16px",
              backgroundColor: "rgba(59,130,246,0.08)",
              border: "1px solid rgba(59,130,246,0.2)",
              boxShadow: "0 10px 24px rgba(59,130,246,0.1)",
            }}
          >
            <strong style={{ fontSize: "13px", color: "#0f172a" }}>{selectedIds.length} selected</strong>
            <button
              onClick={() => handleBatchVisibility(true)}
              style={{
                padding: "8px 10px",
                borderRadius: "10px",
                border: "1px solid rgba(34,197,94,0.4)",
                backgroundColor: "rgba(34,197,94,0.12)",
                color: "#15803d",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Publish
            </button>
            <button
              onClick={() => handleBatchVisibility(false)}
              style={{
                padding: "8px 10px",
                borderRadius: "10px",
                border: "1px solid rgba(148,163,184,0.5)",
                backgroundColor: "white",
                color: "#0f172a",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Hide
            </button>
            <button
              onClick={handleBatchDelete}
              style={{
                padding: "8px 10px",
                borderRadius: "10px",
                border: "1px solid rgba(239,68,68,0.45)",
                backgroundColor: "white",
                color: "#b91c1c",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Delete
            </button>
            <button
              onClick={clearSelection}
              style={{
                padding: "8px 10px",
                borderRadius: "10px",
                border: "1px solid rgba(148,163,184,0.5)",
                backgroundColor: "white",
                color: "#475569",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
        )}

        <div style={{ display: "grid", gap: "18px" }}>
          {viewMode === "all" && (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "grid",
                gap: "12px",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              }}
            >
              {flattenedAll.map(({ course, item }) => (
                <li
                  key={item.id}
                  style={{
                    padding: "12px",
                    borderRadius: "14px",
                    border: "1px solid rgba(226,232,240,0.8)",
                    backgroundColor: "white",
                    boxShadow: "0 10px 22px rgba(15,23,42,0.06)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    boxSizing: "border-box",
                  }}
                >
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      style={{ width: "14px", height: "14px" }}
                    />
                    <span
                      style={{
                        padding: "4px 8px",
                        borderRadius: "999px",
                        backgroundColor: "rgba(59,130,246,0.12)",
                        color: "#1d4ed8",
                        fontWeight: 700,
                        fontSize: "11px",
                      }}
                    >
                      {course.title}
                    </span>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: "999px",
                        backgroundColor: item.visibleToStudents ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.2)",
                        color: item.visibleToStudents ? "#15803d" : "#475569",
                        fontWeight: 700,
                        fontSize: "11px",
                        textTransform: "uppercase",
                        marginLeft: "auto",
                      }}
                    >
                      {item.visibleToStudents ? "Visible" : "Hidden"}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <span
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "12px",
                        backgroundColor: "rgba(226,232,240,0.7)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "18px",
                        border: "1px solid rgba(226,232,240,0.9)",
                      }}
                    >
                      {TYPE_ICONS[item.type] || "📁"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                        <h4
                          style={{
                            margin: 0,
                            fontSize: "14px",
                            color: "#0f172a",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.title}
                        </h4>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: "999px",
                            fontSize: "10px",
                            textTransform: "uppercase",
                            backgroundColor: "rgba(15,23,42,0.06)",
                            color: "#1e3a8a",
                            letterSpacing: "0.08em",
                          }}
                        >
                          {item.type}
                        </span>
                      </div>
                      {item.description && (
                        <p
                          style={{
                            marginTop: "4px",
                            fontSize: "12px",
                            color: "#475569",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: "12px", color: "#2563eb", fontWeight: 600 }}
                      >
                        Open resource
                      </a>
                    )}
                    {item.originalFileName && (
                      <span style={{ fontSize: "11px", color: "#94a3b8" }}>({item.originalFileName})</span>
                    )}
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                      Added {item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      onClick={() => handleToggleVisibility(item)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "10px",
                        border: "1px solid rgba(148,163,184,0.6)",
                        backgroundColor: "white",
                        color: item.visibleToStudents ? "#15803d" : "#475569",
                        fontWeight: 700,
                        cursor: "pointer",
                        fontSize: "12px",
                        minWidth: "130px",
                        flex: "0 0 auto",
                      }}
                    >
                      {item.visibleToStudents ? "Hide from students" : "Publish"}
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "10px",
                        border: "1px solid rgba(239,68,68,0.45)",
                        backgroundColor: "white",
                        color: "#b91c1c",
                        fontWeight: 700,
                        cursor: "pointer",
                        fontSize: "12px",
                        minWidth: "90px",
                        flex: "0 0 auto",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {viewMode === "byCourse" && filteredByCourse.map(({ course, items }) => {
            const isExpanded = expandedCourses[course.id];
            const description = isExpanded
              ? course.description
              : `${course.description.slice(0, 110)}${course.description.length > 110 ? "..." : ""}`;

            return (
              <section
                key={course.id}
                style={{
                  borderRadius: "22px",
                  padding: "18px 18px 22px",
                  backgroundColor: "white",
                  border: "1px solid rgba(226,232,240,0.8)",
                  boxShadow: "0 18px 38px rgba(15,23,42,0.08)",
                  display: "grid",
                  gap: "14px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <div style={{ minWidth: "280px" }}>
                    <h3 style={{ margin: 0, fontSize: "18px", color: "#0f172a" }}>{course.title}</h3>
                    <p style={{ marginTop: "4px", fontSize: "13px", color: "#475569" }}>{description}</p>
                    {course.description.length > 110 && (
                      <button
                        onClick={() => toggleCourseExpansion(course.id)}
                        style={{
                          padding: 0,
                          border: "none",
                          background: "transparent",
                          color: "#2563eb",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        {isExpanded ? "Show less" : "Show more"}
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                    <span
                      style={{
                        padding: "6px 10px",
                        borderRadius: "999px",
                        backgroundColor: "rgba(59,130,246,0.12)",
                        color: "#1d4ed8",
                        fontWeight: 600,
                        fontSize: "12px",
                      }}
                    >
                      {items.length} resources
                    </span>
                    <a
                      href="/teacher/dashboard#upload"
                      style={{
                        padding: "8px 12px",
                        borderRadius: "12px",
                        border: "1px solid rgba(59,130,246,0.4)",
                        backgroundColor: "rgba(59,130,246,0.08)",
                        color: "#1d4ed8",
                        fontWeight: 600,
                        textDecoration: "none",
                        fontSize: "12px",
                      }}
                    >
                      New resource
                    </a>
                    <a
                      href={`/courses/${course.id}`}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "12px",
                        border: "1px solid rgba(148,163,184,0.3)",
                        backgroundColor: "white",
                        color: "#0f172a",
                        fontWeight: 600,
                        textDecoration: "none",
                        fontSize: "12px",
                      }}
                    >
                      View course
                    </a>
                  </div>
                </div>

                {items.length === 0 ? (
                  <p style={{ margin: 0, fontSize: "13px", color: "#94a3b8" }}>
                    No resources yet. Upload your first item for this course.
                  </p>
                ) : (
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      display: "grid",
                      gap: "12px",
                      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                    }}
                  >
                    {sortItems(items).map((item) => (
                      <li
                        key={item.id}
                        style={{
                          padding: "12px",
                          borderRadius: "14px",
                          border: "1px solid rgba(226,232,240,0.8)",
                          backgroundColor: "white",
                          boxShadow: "0 10px 22px rgba(15,23,42,0.06)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          boxSizing: "border-box",
                        }}
                      >
                        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(item.id)}
                            onChange={() => toggleSelect(item.id)}
                            style={{ width: "14px", height: "14px" }}
                          />
                          <span
                            style={{
                              width: "36px",
                              height: "36px",
                              borderRadius: "12px",
                              backgroundColor: "rgba(226,232,240,0.7)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "18px",
                              border: "1px solid rgba(226,232,240,0.9)",
                            }}
                          >
                            {TYPE_ICONS[item.type] || "📁"}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                              <h4
                                style={{
                                  margin: 0,
                                  fontSize: "14px",
                                  color: "#0f172a",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {item.title}
                              </h4>
                              <span
                                style={{
                                  padding: "2px 8px",
                                  borderRadius: "999px",
                                  fontSize: "10px",
                                  textTransform: "uppercase",
                                  backgroundColor: "rgba(15,23,42,0.06)",
                                  color: "#1e3a8a",
                                  letterSpacing: "0.08em",
                                }}
                              >
                                {item.type}
                              </span>
                            </div>
                            {item.description && (
                              <p
                                style={{
                                  marginTop: "4px",
                                  fontSize: "12px",
                                  color: "#475569",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  display: "-webkit-box",
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                                }}
                              >
                                {item.description}
                              </p>
                            )}
                          </div>
                          <span
                            style={{
                              padding: "4px 10px",
                              borderRadius: "999px",
                              backgroundColor: item.visibleToStudents ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.2)",
                              color: item.visibleToStudents ? "#15803d" : "#475569",
                              fontWeight: 700,
                              fontSize: "11px",
                              textTransform: "uppercase",
                            }}
                          >
                            {item.visibleToStudents ? "Visible" : "Hidden"}
                          </span>
                        </div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: "12px", color: "#2563eb", fontWeight: 600 }}
                            >
                              Open resource
                            </a>
                          )}
                          {item.originalFileName && (
                            <span style={{ fontSize: "11px", color: "#94a3b8" }}>({item.originalFileName})</span>
                          )}
                          <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                            Added {item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}
                          </span>
                        </div>

                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                          <button
                            onClick={() => handleToggleVisibility(item)}
                            style={{
                              padding: "6px 12px",
                              borderRadius: "10px",
                              border: "1px solid rgba(148,163,184,0.6)",
                              backgroundColor: "white",
                              color: item.visibleToStudents ? "#15803d" : "#475569",
                              fontWeight: 700,
                              cursor: "pointer",
                              fontSize: "12px",
                              minWidth: "130px",
                              flex: "0 0 auto",
                            }}
                          >
                            {item.visibleToStudents ? "Hide from students" : "Publish"}
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            style={{
                              padding: "6px 12px",
                              borderRadius: "10px",
                              border: "1px solid rgba(239,68,68,0.45)",
                              backgroundColor: "white",
                              color: "#b91c1c",
                              fontWeight: 700,
                              cursor: "pointer",
                              fontSize: "12px",
                              minWidth: "90px",
                              flex: "0 0 auto",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}