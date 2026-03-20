"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {addDoc,collection,onSnapshot,orderBy,query,serverTimestamp,updateDoc,doc,} from "firebase/firestore";
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

function hasPaidAccess(enrollment) {
  if (!enrollment) return false;
  const enrollmentStatus =
    typeof enrollment.status === "string" ? enrollment.status.toLowerCase() : "";
  return enrollment.paymentStatus === "paid" || enrollmentStatus === "paid";
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value) {
  const parsed = normalizeDate(value);
  if (!parsed) return "N/A";
  return parsed.toLocaleString();
}

function getSlotLabel(enrollment) {
  const dayLabel = (enrollment?.timeSlotDay || "").trim();
  const startTime = (enrollment?.timeSlotStartTime || "").trim();
  const endTime = (enrollment?.timeSlotEndTime || "").trim();
  if (dayLabel && startTime && endTime) return `${dayLabel} ${startTime} - ${endTime}`;
  return enrollment?.timeSlotLabel || "Schedule pending";
}

function getEnrollmentSortMs(entry) {
  const candidates = [entry?.enrolledAt, entry?.updatedAt, entry?.createdAt];
  for (const candidate of candidates) {
    const parsed = normalizeDate(candidate);
    if (parsed) return parsed.getTime();
  }
  return 0;
}

function isMissingMeetingLink(enrollment) {
  return !(enrollment?.meetingLink || "").trim();
}

export default function TeacherDashboardPage() {
  const router = useRouter();
  const { sessionUser, loading } = useSessionUser();

  const [materials, setMaterials] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [meetingDrafts, setMeetingDrafts] = useState({});
  const [savingMeetingId, setSavingMeetingId] = useState(null);

  const [courseId, setCourseId] = useState(courseCatalog[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [type, setType] = useState(RESOURCE_TYPES[0]?.value ?? "video");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [visibleToStudents, setVisibleToStudents] = useState(true);
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  const [expandedCourseId, setExpandedCourseId] = useState(courseCatalog[0]?.id ?? "");
  const [meetingCourseFilter, setMeetingCourseFilter] = useState("all");
  const [meetingSearch, setMeetingSearch] = useState("");
  const [meetingStatusFilter, setMeetingStatusFilter] = useState("pending");
  const [expandedMeetingGroups, setExpandedMeetingGroups] = useState({});

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
    if (!sessionUser) {
      setEnrollments([]);
      return;
    }

    const enrollmentsQuery = query(collection(db, "enrollments"), orderBy("enrolledAt", "desc"));
    const unsubscribe = onSnapshot(
      enrollmentsQuery,
      (snapshot) => {
        const records = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            docId: docSnapshot.id,
            ...data,
            enrolledAt: normalizeDate(data.enrolledAt),
            updatedAt: normalizeDate(data.updatedAt),
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

  useEffect(() => {
    if (!sessionUser) {
      setMaterials([]);
      return;
    }

    const materialsQuery = query(collection(db, "materials"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      materialsQuery,
      (snapshot) => {
        const nextMaterials = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            ...data,
            createdAt: normalizeDate(data.createdAt),
            updatedAt: normalizeDate(data.updatedAt),
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

  const summary = useMemo(() => {
    const paidEnrollments = enrollments.filter((entry) => hasPaidAccess(entry));
    const uniqueStudents = new Set(
      paidEnrollments
        .map((entry) => entry.studentUid || entry.studentEmail || "")
        .filter(Boolean)
    );

    const pendingMeetingLinks = paidEnrollments.filter((entry) => !(entry.meetingLink || "").trim()).length;

    return {
      totalResources: materials.length,
      assignmentCount: materials.filter((item) => item.type === "assignment").length,
      publishedCount: materials.filter((item) => item.visibleToStudents).length,
      paidEnrollmentCount: paidEnrollments.length,
      activeStudentCount: uniqueStudents.size,
      pendingMeetingLinks,
    };
  }, [materials, enrollments]);

  const courseSnapshots = useMemo(() => {
    return courseCatalog.map((course) => {
      const courseMaterials = materials.filter((item) => item.courseId === course.id);
      const paidEnrollments = enrollments.filter(
        (entry) => entry.courseId === course.id && hasPaidAccess(entry)
      );

      const latestUpdateMs = courseMaterials
        .map((item) => normalizeDate(item.updatedAt || item.createdAt)?.getTime() ?? 0)
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => b - a)[0];

      const moduleCount = Array.isArray(course.syllabus) ? course.syllabus.length : 0;
      const readinessBase = moduleCount ? moduleCount * 2 : 1;
      const readinessScore = Math.min(100, Math.round((courseMaterials.length / readinessBase) * 100));

      return {
        course,
        moduleCount,
        materialsCount: courseMaterials.length,
        assignmentsCount: courseMaterials.filter((item) => item.type === "assignment").length,
        videosCount: courseMaterials.filter((item) => item.type === "video").length,
        paidEnrollmentCount: paidEnrollments.length,
        latestUpdate: latestUpdateMs ? formatDateTime(latestUpdateMs) : "N/A",
        readinessScore,
      };
    });
  }, [materials, enrollments]);

  const scopedMeetingEnrollments = useMemo(() => {
    const search = meetingSearch.trim().toLowerCase();
    return [...enrollments]
      .filter((entry) => meetingCourseFilter === "all" || entry.courseId === meetingCourseFilter)
      .filter((entry) => {
        if (!search) return true;
        const haystack = `${entry.studentName || ""} ${entry.studentEmail || ""} ${entry.courseTitle || ""}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => getEnrollmentSortMs(b) - getEnrollmentSortMs(a));
  }, [enrollments, meetingCourseFilter, meetingSearch]);

  const filteredEnrollments = useMemo(() => {
    if (meetingStatusFilter === "all") return scopedMeetingEnrollments;
    return scopedMeetingEnrollments.filter((entry) => isMissingMeetingLink(entry));
  }, [scopedMeetingEnrollments, meetingStatusFilter]);

  const pendingMeetingCountInScope = useMemo(
    () => scopedMeetingEnrollments.filter((entry) => isMissingMeetingLink(entry)).length,
    [scopedMeetingEnrollments]
  );

  const groupedMeetingEnrollments = useMemo(() => {
    const groups = new Map();
    for (const entry of filteredEnrollments) {
      const course = courseCatalog.find((item) => item.id === entry.courseId);
      const courseId = entry.courseId || course?.id || "unknown";
      const courseTitle = course?.title || entry.courseTitle || "Other courses";
      const key = `${courseId}::${courseTitle}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          courseId,
          courseTitle,
          items: [],
          pendingCount: 0,
        });
      }
      const group = groups.get(key);
      group.items.push(entry);
      if (isMissingMeetingLink(entry)) group.pendingCount += 1;
    }

    const courseOrder = new Map(courseCatalog.map((item, index) => [item.id, index]));
    return Array.from(groups.values()).sort((a, b) => {
      const indexA = courseOrder.has(a.courseId) ? courseOrder.get(a.courseId) : Number.MAX_SAFE_INTEGER;
      const indexB = courseOrder.has(b.courseId) ? courseOrder.get(b.courseId) : Number.MAX_SAFE_INTEGER;
      if (indexA !== indexB) return indexA - indexB;
      return a.courseTitle.localeCompare(b.courseTitle);
    });
  }, [filteredEnrollments]);

  useEffect(() => {
    setExpandedMeetingGroups((prev) => {
      if (!groupedMeetingEnrollments.length) return {};
      const next = {};
      for (const group of groupedMeetingEnrollments) {
        if (Object.prototype.hasOwnProperty.call(prev, group.key)) {
          next[group.key] = prev[group.key];
        } else {
          next[group.key] = meetingCourseFilter !== "all";
        }
      }
      return next;
    });
  }, [groupedMeetingEnrollments, meetingCourseFilter]);

  function resetForm() {
    setTitle("");
    setDescription("");
    setUrl("");
    setVisibleToStudents(true);
    setFile(null);
  }

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
        const storageRef = ref(storage, `teacher-resources/${courseId}/${Date.now()}-${file.name}`);
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

  async function handleSaveMeetingLink(enrollment) {
    if (!enrollment?.docId) return;
    const draft = (meetingDrafts[enrollment.docId] ?? enrollment.meetingLink ?? "").trim();
    setSavingMeetingId(enrollment.docId);

    try {
      await updateDoc(doc(db, "enrollments", enrollment.docId), {
        meetingLink: draft,
        meetingLinkUpdatedAt: serverTimestamp(),
        meetingLinkUpdatedBy: sessionUser?.email ?? "instructor",
      });
    } catch (error) {
      console.error("Failed to update meeting link", error);
      alert("Unable to save meeting link. Please try again.");
    } finally {
      setSavingMeetingId(null);
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

  function handleOpenUploadForCourse(nextCourseId) {
    setCourseId(nextCourseId);
    const uploadSection = document.getElementById("upload-section");
    if (uploadSection) {
      uploadSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function toggleMeetingGroup(groupKey) {
    setExpandedMeetingGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  }

  if (loading || !sessionUser || sessionUser.role !== "teacher") return null;

  const teacherDisplayName =
    sessionUser?.displayName || sessionUser?.name || sessionUser?.email || "Teacher";
  const teacherInitial = teacherDisplayName.slice(0, 1).toUpperCase();
  const firstName = teacherDisplayName.split(" ")[0] || teacherDisplayName;
  const heroSecondaryButtonStyle = {
    padding: "10px 14px",
    background: "#ffffff",
    color: "#0f172a",
    border: "1px solid rgba(226, 232, 240, 0.88)",
    borderRadius: "12px",
    boxShadow: "0 10px 22px rgba(15, 23, 42, 0.18)",
    textDecoration: "none",
    fontSize: "13px",
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    lineHeight: 1,
  };
  const heroCtaIconStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    fontSize: "14px",
    lineHeight: 1,
  };
  const heroCtaLabelStyle = {
    display: "inline-flex",
    alignItems: "center",
    lineHeight: 1.2,
  };
  const insightActionButtonStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px",
    borderRadius: "10px",
    border: "1px solid rgba(37, 99, 235, 0.32)",
    background: "linear-gradient(120deg, #2563eb, #1d4ed8)",
    boxShadow: "0 10px 20px rgba(37, 99, 235, 0.22)",
    fontSize: "12px",
    fontWeight: 700,
    color: "#ffffff",
    textDecoration: "none",
    width: "fit-content",
  };
  const hiddenResources = Math.max(0, summary.totalResources - summary.publishedCount);
  const averageReadiness = courseSnapshots.length
    ? Math.round(
        courseSnapshots.reduce((acc, course) => acc + (Number(course.readinessScore) || 0), 0) /
          courseSnapshots.length
      )
    : 0;
  const topCourseByStudents =
    courseSnapshots.length > 0
      ? [...courseSnapshots].sort((a, b) => b.paidEnrollmentCount - a.paidEnrollmentCount)[0]
      : null;
  const quickInsights = [
    {
      label: "Pending meeting links",
      value: summary.pendingMeetingLinks,
      note: "Students still missing a saved meeting URL.",
      actionLabel: "Complete now",
      actionHref: "#meeting-links",
    },
    {
      label: "Hidden resources",
      value: hiddenResources,
      note: "Materials not visible to students yet.",
      actionLabel: "Review visibility",
      actionHref: "/teacher/resources",
      isLink: true,
    },
    {
      label: "Average readiness",
      value: `${averageReadiness}%`,
      note: "Average delivery readiness across courses.",
      actionLabel: "Open modules",
      actionHref: "#course-modules",
    },
    {
      label: "Top course by students",
      value: topCourseByStudents?.course?.title || "No enrollments",
      note: topCourseByStudents
        ? `${topCourseByStudents.paidEnrollmentCount} paid students`
        : "No paid enrollments yet",
      actionLabel: "Open schedule",
      actionHref: "/teacher/schedule",
      isLink: true,
    },
  ];

  return (
    <main className="teacher-dashboard">
      <div className="shell">
        <section className="hero-card">
          <div className="hero-top">
            <div className="teacher-chip">
              <span className="avatar">{teacherInitial}</span>
              <div>
                <p className="eyebrow">Teacher Command Center</p>
                <h1>Welcome back, {firstName}</h1>
               
              </div>
            </div>
            <button className="danger-btn" onClick={handleLogout}>
              Log out
            </button>
          </div>

          <div className="hero-actions">
            <a href="#upload-section" className="primary-cta">
              Publish resource
            </a>
            <Link href="/teacher/schedule" className="ghost-cta" style={heroSecondaryButtonStyle}>
              <span aria-hidden="true" style={heroCtaIconStyle}>🗓</span>
              <span style={heroCtaLabelStyle}>Manage schedule</span>
            </Link>
            <Link href="/teacher/practice-logs" className="ghost-cta" style={heroSecondaryButtonStyle}>
              <span aria-hidden="true" style={heroCtaIconStyle}>📈</span>
              <span style={heroCtaLabelStyle}>Review practice logs</span>
            </Link>
            <Link href="/teacher/resources" className="ghost-cta" style={heroSecondaryButtonStyle}>
              <span aria-hidden="true" style={heroCtaIconStyle}>📚</span>
              <span style={heroCtaLabelStyle}>Open resource library</span>
            </Link>
          </div>

          <div className="metric-grid">
            <MetricCard label="Active students" value={summary.activeStudentCount} />
            <MetricCard label="Paid enrollments" value={summary.paidEnrollmentCount} />
            <MetricCard label="Resources" value={summary.totalResources} />
            <MetricCard label="Pending meeting links" value={summary.pendingMeetingLinks} tone="warning" />
          </div>
        </section>

        <section className="insight-panel">
          <div className="panel-header">
            <p className="eyebrow">Today focus</p>
            <h2>Quick priorities</h2>
            <p>A compact view of what needs your attention right now.</p>
          </div>
          <div className="insight-grid">
            {quickInsights.map((item) => (
              <article key={item.label} className="insight-card">
                <p className="insight-label">{item.label}</p>
                <strong className="insight-value">{item.value}</strong>
                <p className="insight-note">{item.note}</p>
                {item.isLink ? (
                  <Link href={item.actionHref} className="insight-action" style={insightActionButtonStyle}>
                    {item.actionLabel}
                  </Link>
                ) : (
                  <a href={item.actionHref} className="insight-action" style={insightActionButtonStyle}>
                    {item.actionLabel}
                  </a>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="main-grid">
          <section id="course-modules" className="panel">
            <div className="panel-header">
              <p className="eyebrow">Coursera-style Structure</p>
              <h2>Course modules and readiness</h2>
              <p>
                Keep course overview visible: modules, resources, student count, and delivery readiness.
              </p>
            </div>

            <div className="course-list">
              {courseSnapshots.map((snapshot) => {
                const isOpen = expandedCourseId === snapshot.course.id;
                return (
                  <article key={snapshot.course.id} className="course-card">
                    <button
                      type="button"
                      className="course-toggle"
                      onClick={() =>
                        setExpandedCourseId((prev) => (prev === snapshot.course.id ? "" : snapshot.course.id))
                      }
                    >
                      <div>
                        <h3>{snapshot.course.title}</h3>
                        <p>
                          {snapshot.course.level} | {snapshot.course.duration} | {snapshot.moduleCount} modules
                        </p>
                      </div>
                      <span className="expand-indicator">{isOpen ? "Hide" : "View"}</span>
                    </button>

                    <div className="course-stat-row">
                      <span>{snapshot.paidEnrollmentCount} students</span>
                      <span>{snapshot.materialsCount} resources</span>
                      <span>{snapshot.assignmentsCount} assignments</span>
                      <span>{snapshot.videosCount} videos</span>
                      <span>Readiness {snapshot.readinessScore}%</span>
                    </div>

                    {isOpen && (
                      <div className="course-detail">
                        <p className="course-headline">{snapshot.course.headline}</p>
                        <p className="course-description">{snapshot.course.description}</p>
                        <p className="course-updated">Last updated: {snapshot.latestUpdate}</p>

                        <div className="module-list">
                          {snapshot.course.syllabus?.map((module) => (
                            <div key={module.id} className="module-item">
                              <div>
                                <p className="module-week">{module.weekLabel}</p>
                                <h4>{module.title}</h4>
                              </div>
                              <p className="module-duration">{module.duration}</p>
                              <p className="module-formats">{(module.formats || []).join(" | ")}</p>
                              <p className="module-task">Practice task: {module.practiceTask}</p>
                            </div>
                          ))}
                        </div>

                        <div className="course-detail-actions">
                          <button
                            type="button"
                            className="solid-btn"
                            onClick={() => handleOpenUploadForCourse(snapshot.course.id)}
                          >
                            Upload resource for this course
                          </button>
                          <button
                            type="button"
                            className="outline-btn"
                            onClick={() => router.push("/teacher/resources")}
                          >
                            Manage all resources
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <div className="right-stack">
            <section id="upload-section" className="panel">
              <div className="panel-header">
              
                <h2>Upload a new resource</h2>
                <p>Publish quickly, then decide visibility for students.</p>
              </div>

              <form onSubmit={handleSubmit} className="form-grid">
                <label className="field">
                  <span>Course</span>
                  <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                    {courseCatalog.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="split-grid">
                  <label className="field">
                    <span>Title</span>
                    <input
                      type="text"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Resource title"
                    />
                  </label>

                  <label className="field">
                    <span>Type</span>
                    <select value={type} onChange={(event) => setType(event.target.value)}>
                      {RESOURCE_TYPES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="field">
                  <span>Description</span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={3}
                    placeholder="Short notes for students"
                  />
                </label>

                <label className="field">
                  <span>Link / file URL</span>
                  <input
                    type="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://..."
                  />
                </label>

                <label className="field">
                  <span>Upload file (optional)</span>
                  <div className="file-row">
                    <label htmlFor="fileUpload" className="file-btn">
                      Choose file
                    </label>
                    <span className="file-name">{file ? file.name : "No file chosen"}</span>
                    <input
                      id="fileUpload"
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.mp3,.mp4"
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                      hidden
                    />
                  </div>
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={visibleToStudents}
                    onChange={(event) => setVisibleToStudents(event.target.checked)}
                  />
                  <span>Visible to students</span>
                </label>

                <button type="submit" className="solid-btn" disabled={isUploading}>
                  {isUploading ? "Uploading..." : "Save resource"}
                </button>
              </form>
            </section>

            <section id="meeting-links" className="panel">
              <div className="panel-header">
                <h2>Enrollment meeting links</h2>
                <p>Search and update meeting links by student or course.</p>
              </div>

              <div className="meeting-toolbar">
                <div className="filters">
                  <select
                    value={meetingCourseFilter}
                    onChange={(event) => setMeetingCourseFilter(event.target.value)}
                  >
                    <option value="all">All courses</option>
                    {courseCatalog.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>

                  <input
                    value={meetingSearch}
                    onChange={(event) => setMeetingSearch(event.target.value)}
                    placeholder="Search student or email"
                  />
                </div>

                <div className="meeting-status-toggle">
                  <button
                    type="button"
                    className={meetingStatusFilter === "pending" ? "status-filter-btn active" : "status-filter-btn"}
                    onClick={() => setMeetingStatusFilter("pending")}
                  >
                    Pending only ({pendingMeetingCountInScope})
                  </button>
                  <button
                    type="button"
                    className={meetingStatusFilter === "all" ? "status-filter-btn active" : "status-filter-btn"}
                    onClick={() => setMeetingStatusFilter("all")}
                  >
                    All ({scopedMeetingEnrollments.length})
                  </button>
                </div>
              </div>

              {filteredEnrollments.length === 0 ? (
                <p className="empty-state">No enrollments match the current filter.</p>
              ) : (
                <div className="meeting-groups-scroll">
                  {groupedMeetingEnrollments.map((group) => {
                    const isExpanded = expandedMeetingGroups[group.key] ?? false;
                    return (
                      <section key={group.key} className="meeting-group">
                        <button
                          type="button"
                          className="meeting-group-toggle"
                          onClick={() => toggleMeetingGroup(group.key)}
                        >
                          <div className="meeting-group-meta">
                            <p className="meeting-group-title">{group.courseTitle}</p>
                            <p className="meeting-group-sub">
                              {group.items.length} students · {group.pendingCount} missing links
                            </p>
                          </div>
                          <span className="meeting-group-arrow">{isExpanded ? "Hide ▾" : "Show ▸"}</span>
                        </button>

                        {isExpanded && (
                          <div className="enrollment-list">
                            {group.items.map((enrollment) => {
                              const course = courseCatalog.find((item) => item.id === enrollment.courseId);
                              const meetingValue = meetingDrafts[enrollment.docId] ?? enrollment.meetingLink ?? "";
                              const isSaving = savingMeetingId === enrollment.docId;

                              return (
                                <article key={enrollment.docId} className="enrollment-card">
                                  <div className="enrollment-head">
                                    <div>
                                      <p className="course-name">{course?.title || enrollment.courseTitle || "Course"}</p>
                                      <p className="student-name">
                                        {enrollment.studentName || enrollment.studentEmail || "Student"}
                                      </p>
                                      <p className="slot-label">Weekly slot: {getSlotLabel(enrollment)}</p>
                                    </div>
                                    <span className={hasPaidAccess(enrollment) ? "status-chip paid" : "status-chip pending"}>
                                      {hasPaidAccess(enrollment) ? "Paid" : "Pending"}
                                    </span>
                                  </div>

                                  <input
                                    type="url"
                                    value={meetingValue}
                                    onChange={(event) =>
                                      setMeetingDrafts((prev) => ({
                                        ...prev,
                                        [enrollment.docId]: event.target.value,
                                      }))
                                    }
                                    placeholder="https://meet.google.com/..."
                                  />

                                  <div className="enrollment-actions">
                                    <button
                                      type="button"
                                      className="solid-btn"
                                      onClick={() => handleSaveMeetingLink(enrollment)}
                                      disabled={isSaving}
                                    >
                                      {isSaving ? "Saving..." : "Save link"}
                                    </button>
                                    {enrollment.meetingLink ? (
                                      <a href={enrollment.meetingLink} target="_blank" rel="noreferrer" className="outline-btn">
                                        Open link
                                      </a>
                                    ) : (
                                      <span className="hint">No link saved yet.</span>
                                    )}
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </section>
      </div>

      <style jsx>{`
        .teacher-dashboard {
          min-height: 100vh;
          background: radial-gradient(circle at 0% 0%, #fef9c3 0%, #f8fafc 48%),
            linear-gradient(160deg, #f1f5f9 0%, #e2e8f0 100%);
          padding: 28px 18px 48px;
          font-family: var(--font-geist-sans), "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
          color: #0f172a;
        }

        .shell {
          width: min(1260px, 100%);
          margin: 0 auto;
          display: grid;
          gap: 18px;
        }

        .hero-card {
          border-radius: 24px;
          padding: 22px;
          background: linear-gradient(130deg, #0f172a 0%, #1d4ed8 58%, #0ea5e9 100%);
          color: #f8fafc;
          box-shadow: 0 20px 44px rgba(15, 23, 42, 0.25);
          display: grid;
          gap: 16px;
        }

        .hero-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          flex-wrap: wrap;
        }

        .teacher-chip {
          display: flex;
          gap: 14px;
          align-items: center;
        }

        .avatar {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: rgba(248, 250, 252, 0.18);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 22px;
          border: 1px solid rgba(248, 250, 252, 0.35);
        }

        .eyebrow {
          margin: 0;
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(226, 232, 240, 0.9);
        }

        .hero-card h1 {
          margin: 4px 0;
          font-size: 28px;
          line-height: 1.2;
        }

        .hero-subtitle {
          margin: 0;
          color: rgba(226, 232, 240, 0.88);
          max-width: 720px;
          font-size: 14px;
        }

        .hero-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .primary-cta,
        .ghost-cta,
        .solid-btn,
        .outline-btn,
        .danger-btn,
        .file-btn {
          border: none;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          justify-content: center;
          align-items: center;
          transition: all 0.18s ease;
        }

        .primary-cta {
          padding: 10px 16px;
          background: #f8fafc;
          color: #0f172a;
          border: 1px solid rgba(226, 232, 240, 0.85);
          box-shadow: 0 10px 22px rgba(15, 23, 42, 0.18);
        }

        .ghost-cta {
          padding: 10px 14px;
          background: #ffffff;
          color: #0f172a;
          border: 1px solid rgba(226, 232, 240, 0.88);
          box-shadow: 0 10px 22px rgba(15, 23, 42, 0.18);
        }

        .primary-cta:hover,
        .ghost-cta:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.22);
        }

        .danger-btn {
          padding: 10px 14px;
          background: rgba(248, 113, 113, 0.24);
          color: #fff;
          border: 1px solid rgba(252, 165, 165, 0.35);
        }

        .metric-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 10px;
        }

        .main-grid {
          display: grid;
          gap: 14px;
          grid-template-columns: minmax(0, 1.3fr) minmax(340px, 1fr);
          align-items: start;
        }

        .insight-panel {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          padding: 18px;
          box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
          display: grid;
          gap: 12px;
        }

        .insight-grid {
          display: grid;
          gap: 10px;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }

        .insight-card {
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 12px;
          background: #f8fafc;
          display: grid;
          gap: 5px;
        }

        .insight-label {
          margin: 0;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #0284c7;
          font-weight: 700;
        }

        .insight-value {
          font-size: 18px;
          line-height: 1.25;
          color: #0f172a;
        }

        .insight-note {
          margin: 0;
          font-size: 12px;
          color: #475569;
          line-height: 1.4;
          min-height: 34px;
        }

        .insight-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid rgba(37, 99, 235, 0.32);
          background: linear-gradient(120deg, #2563eb, #1d4ed8);
          box-shadow: 0 10px 20px rgba(37, 99, 235, 0.22);
          font-size: 12px;
          font-weight: 700;
          color: #ffffff;
          text-decoration: none;
          width: fit-content;
          transition: all 0.18s ease;
        }

        .insight-action:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 24px rgba(37, 99, 235, 0.26);
        }

        .insight-action:active {
          transform: translateY(0);
        }

        .panel {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          padding: 18px;
          box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
          display: grid;
          gap: 14px;
        }

        .panel-header h2 {
          margin: 6px 0 4px;
          font-size: 22px;
        }

        .panel-header p {
          margin: 0;
          color: #475569;
          font-size: 13px;
          line-height: 1.45;
        }

        .course-list {
          display: grid;
          gap: 12px;
        }

        .course-card {
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 12px;
          background: #f8fafc;
          display: grid;
          gap: 10px;
        }

        .course-toggle {
          border: none;
          background: transparent;
          padding: 0;
          text-align: left;
          display: flex;
          justify-content: space-between;
          gap: 8px;
          cursor: pointer;
          color: inherit;
        }

        .course-toggle h3 {
          margin: 0;
          font-size: 18px;
        }

        .course-toggle p {
          margin: 4px 0 0;
          font-size: 12px;
          color: #64748b;
        }

        .expand-indicator {
          align-self: center;
          font-size: 12px;
          font-weight: 600;
          color: #0ea5e9;
          border: 1px solid #bae6fd;
          padding: 6px 10px;
          border-radius: 999px;
          background: #f0f9ff;
        }

        .course-stat-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .course-stat-row span {
          font-size: 12px;
          color: #334155;
          border: 1px solid #e2e8f0;
          background: #fff;
          border-radius: 999px;
          padding: 5px 10px;
        }

        .course-detail {
          border-top: 1px solid #e2e8f0;
          padding-top: 10px;
          display: grid;
          gap: 10px;
        }

        .course-headline {
          margin: 0;
          color: #0f172a;
          font-weight: 600;
          font-size: 13px;
        }

        .course-description,
        .course-updated {
          margin: 0;
          color: #475569;
          font-size: 13px;
          line-height: 1.45;
        }

        .module-list {
          display: grid;
          gap: 8px;
        }

        .module-item {
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 10px;
          background: #fff;
          display: grid;
          gap: 4px;
        }

        .module-week {
          margin: 0;
          font-size: 11px;
          text-transform: uppercase;
          color: #0284c7;
          letter-spacing: 0.08em;
          font-weight: 700;
        }

        .module-item h4 {
          margin: 0;
          font-size: 14px;
          color: #0f172a;
        }

        .module-duration,
        .module-formats,
        .module-task {
          margin: 0;
          font-size: 12px;
          color: #475569;
          line-height: 1.4;
        }

        .course-detail-actions,
        .enrollment-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .solid-btn {
          padding: 10px 14px;
          background: linear-gradient(120deg, #2563eb, #1d4ed8);
          color: #fff;
        }

        .solid-btn:disabled {
          background: #94a3b8;
          cursor: not-allowed;
        }

        .outline-btn {
          padding: 9px 14px;
          border: 1px solid #93c5fd;
          background: #eff6ff;
          color: #1d4ed8;
        }

        .right-stack {
          display: grid;
          gap: 14px;
        }

        .form-grid,
        .field {
          display: grid;
          gap: 6px;
        }

        .split-grid {
          display: grid;
          gap: 10px;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        }

        .field span {
          font-size: 12px;
          color: #0f172a;
          font-weight: 600;
        }

        .field input,
        .field select,
        .field textarea,
        .filters input,
        .filters select,
        .enrollment-card input {
          width: 100%;
          border: 1px solid #cbd5e1;
          background: #fff;
          color: #0f172a;
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 13px;
        }

        .checkbox-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #334155;
        }

        .file-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .file-btn {
          background: #0f172a;
          color: #fff;
          padding: 8px 12px;
        }

        .file-name,
        .hint,
        .empty-state {
          font-size: 12px;
          color: #64748b;
        }

        .filters {
          display: grid;
          gap: 8px;
          grid-template-columns: minmax(140px, 190px) minmax(0, 1fr);
        }

        .meeting-toolbar {
          display: grid;
          gap: 10px;
        }

        .meeting-status-toggle {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .status-filter-btn {
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          background: #ffffff;
          color: #334155;
          font-size: 12px;
          font-weight: 600;
          padding: 7px 10px;
          cursor: pointer;
        }

        .status-filter-btn.active {
          border-color: rgba(37, 99, 235, 0.45);
          background: rgba(37, 99, 235, 0.12);
          color: #1d4ed8;
        }

        .meeting-groups-scroll {
          display: grid;
          gap: 10px;
          max-height: 720px;
          overflow: auto;
          padding-right: 4px;
        }

        .meeting-group {
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          background: #ffffff;
          padding: 10px;
          display: grid;
          gap: 10px;
        }

        .meeting-group-toggle {
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          border-radius: 12px;
          padding: 10px;
          text-align: left;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          cursor: pointer;
        }

        .meeting-group-meta {
          display: grid;
          gap: 2px;
        }

        .meeting-group-title {
          margin: 0;
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          line-height: 1.35;
        }

        .meeting-group-sub {
          margin: 0;
          font-size: 12px;
          color: #64748b;
          line-height: 1.35;
        }

        .meeting-group-arrow {
          font-size: 12px;
          color: #1d4ed8;
          font-weight: 700;
          white-space: nowrap;
        }

        .enrollment-list {
          display: grid;
          gap: 10px;
        }

        .enrollment-card {
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 12px;
          background: #f8fafc;
          display: grid;
          gap: 8px;
        }

        .enrollment-head {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
        }

        .course-name,
        .student-name,
        .slot-label {
          margin: 0;
          line-height: 1.35;
        }

        .course-name {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
        }

        .student-name,
        .slot-label {
          font-size: 12px;
          color: #475569;
        }

        .status-chip {
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 700;
          align-self: flex-start;
        }

        .status-chip.paid {
          color: #0369a1;
          background: #e0f2fe;
          border: 1px solid #bae6fd;
        }

        .status-chip.pending {
          color: #92400e;
          background: #fef3c7;
          border: 1px solid #fde68a;
        }

        @media (max-width: 1080px) {
          .main-grid {
            grid-template-columns: 1fr;
          }

          .meeting-groups-scroll {
            max-height: none;
          }
        }

        @media (max-width: 760px) {
          .teacher-dashboard {
            padding: 20px 12px 36px;
          }

          .hero-card,
          .panel {
            border-radius: 16px;
            padding: 14px;
          }

          .hero-card h1 {
            font-size: 23px;
          }

          .filters {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

function MetricCard({ label, value, tone = "default" }) {
  return (
    <div className={`metric-card ${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <style jsx>{`
        .metric-card {
          border-radius: 14px;
          padding: 12px;
          border: 1px solid rgba(226, 232, 240, 0.3);
          background: rgba(248, 250, 252, 0.12);
          display: grid;
          gap: 4px;
        }

        .metric-card p {
          margin: 0;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(226, 232, 240, 0.82);
        }

        .metric-card strong {
          font-size: 22px;
          line-height: 1.1;
          color: #f8fafc;
        }

        .metric-card.warning {
          background: rgba(250, 204, 21, 0.18);
          border-color: rgba(253, 224, 71, 0.52);
        }
      `}</style>
    </div>
  );
}
