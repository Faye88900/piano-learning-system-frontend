"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut } from "firebase/auth";
import {addDoc,collection,collectionGroup,onSnapshot,orderBy,query,serverTimestamp,where,} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";
import { courseCatalog } from "@/lib/courseCatalog";

const roleLabels = {
  student: "Student",
  teacher: "Teacher",
  admin: "Admin",
};

export default function DashboardPage() {

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
        setEnrolledCourses(records);
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
    if (!sessionUser?.uid) {
      setRescheduleRequests([]);
      return;
    }

    const requestsQuery = query(
      collection(db, "rescheduleRequests"),
      where("studentUid", "==", sessionUser.uid),
      orderBy("createdAt", "desc")
    );

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

  const paymentParam = searchParams?.get("payment");
  const [paymentBanner, setPaymentBanner] = useState(null);

  useEffect(() => {
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

   // 清除查询参数，使横幅只显示一次
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.delete("payment");
    router.replace(params.toString() ? `${pathname}?${params}` : pathname, { scroll: false });
  }, [paymentParam, pathname, router, searchParams]);

  useEffect(() => {
    if (!paymentBanner) return undefined;
    const timer = setTimeout(() => setPaymentBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [paymentBanner]);

  async function handleCreateRescheduleRequest(session, payload) {
    if (!sessionUser) return;
    if (!session?.id) return;

    const requestedDate = payload.requestedDate?.trim();
    if (!requestedDate) {
      alert("Please choose a preferred make-up date.");
      return;
    }

    setSubmittingRequestSessionId(session.id);

    try {
      await addDoc(collection(db, "rescheduleRequests"), {
        sessionId: session.id,
        courseId: session.courseId ?? "",
        courseTitle: session.courseTitle ?? "",
        sessionDate: session.date ?? "",
        sessionStartTime: session.startTime ?? "",
        teacherUid: session.teacherUid ?? "",
        teacherEmail: session.teacherEmail ?? "",
        studentUid: sessionUser.uid,
        studentEmail: sessionUser.email ?? "",
        studentName: sessionUser.profileName || sessionUser.email || "Student",
        requestedDate,
        requestedTime: payload.requestedTime?.trim() || "",
        message: payload.message?.trim() || "",
        status: "pending",
        createdAt: serverTimestamp(),
      });
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
  const upcomingSessionCount = (lessonSessions || []).reduce((total, session) => {
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
            {paymentBanner ? (
              <SectionCard
                title={paymentBanner.title}
                description={paymentBanner.message}
                actions={[]}
              />
            ) : null}
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
    </main>
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
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab?.(item.id)}
              style={{
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
              }}
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
        const statusLabel = enrollment?.status ?? (isEnrolled ? "Enrolled" : null);
        const studentLabel = enrollment?.studentName ?? null;
        const timeLabel = enrollment?.timeSlotLabel ?? "";
        const quizScore =
          typeof enrollment?.quizScore === "number" ? `Latest quiz: ${enrollment.quizScore}%` : null;

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

                {course.quiz && isEnrolled && (
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

                {course.quiz && !isEnrolled && (
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
                    {"\uD83D\uDD12"} Enroll to unlock quiz
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
  const [activeSessionId, setActiveSessionId] = useState(null);
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

  const relevantSessions = (lessonSessions || [])
    .filter((session) => {
      if (!courseIds.has(session.courseId)) return false;
      if (session.archived) return false;
      if (!session?.date) return true;
      const sessionTime = new Date(`${session.date}T${session.startTime || "00:00"}`).getTime();
      if (Number.isNaN(sessionTime)) return true;
      return sessionTime >= pastLimit;
    })
    .sort((a, b) => {
      const dateA = new Date((a.date || '') + 'T' + (a.startTime || '00:00'));
      const dateB = new Date((b.date || '') + 'T' + (b.startTime || '00:00'));
      return dateB.getTime() - dateA.getTime();
    });

  const attendanceMap = new Map();
  for (const record of attendanceRecords || []) {
    if (record.studentEmail === studentEmail || record.studentUid) {
      attendanceMap.set(record.sessionId, record);
    }
  }

  const requestsBySession = useMemo(() => {
    const map = new Map();
    for (const request of rescheduleRequests || []) {
      if (!request?.sessionId) continue;
      const existing = map.get(request.sessionId);
      if (!existing) {
        map.set(request.sessionId, request);
      } else {
        const prevTime = existing.createdAt || '';
        const nextTime = request.createdAt || '';
        if (nextTime > prevTime) {
          map.set(request.sessionId, request);
        }
      }
    }
    return map;
  }, [rescheduleRequests]);

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

  function openRequestForm(session) {
    setActiveSessionId(session.id);
    setRequestDate(session.date || '');
    setRequestTime(session.startTime || '');
    setRequestMessage('');
  }

  async function handleSubmitRequest(event) {
    event.preventDefault();
    if (!activeSessionId) return;
    const session = relevantSessions.find((item) => item.id === activeSessionId);
    if (!session) return;
    if (!requestDate.trim()) {
      alert('Please choose a preferred make-up date.');
      return;
    }

    await onSubmitReschedule?.(session, {
      requestedDate: requestDate,
      requestedTime: requestTime,
      message: requestMessage,
    });
    setActiveSessionId(null);
    setRequestMessage('');
  }

  if (!hasEnrollments) {
    return (
      <p style={{ marginTop: '14px', fontSize: '13px', color: '#475569' }}>
        Enroll in a course to see your attendance history.
      </p>
    );
  }

  if (!relevantSessions.length) {
    return (
      <p style={{ marginTop: '14px', fontSize: '13px', color: '#475569' }}>
        No scheduled lessons yet. Your attendance records will appear here once sessions are scheduled.
      </p>
    );
  }

  return (
    <div style={{ marginTop: '18px', display: 'grid', gap: '16px' }}>
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
                {!relatedRequest && (
                  <button
                    type='button'
                    onClick={() => openRequestForm(session)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '999px',
                      border: '1px solid rgba(14,165,233,0.4)',
                      backgroundColor: 'white',
                      color: '#0369a1',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 6px 12px rgba(14,165,233,0.15)',
                    }}
                  >
                    Request reschedule
                  </button>
                )}
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
                <strong style={{ fontWeight: 600 }}>Reschedule request:</strong>{' '}
                {(requestStyle && requestStyle.label) || (relatedRequest && relatedRequest.status)}
                {relatedRequest?.requestedDate
                  ? ' · ' + relatedRequest.requestedDate + (relatedRequest.requestedTime ? ' ' + relatedRequest.requestedTime : '')
                  : ''}
                {relatedRequest?.message ? ' · ' + relatedRequest.message : ''}
                {relatedRequest?.resolutionNote ? ' · Instructor note: ' + relatedRequest.resolutionNote : ''}
              </div>
            )}

            {activeSessionId === session.id && !relatedRequest && (
              <div
                style={{
                  borderRadius: '18px',
                  border: '1px solid rgba(148,163,184,0.25)',
                  backgroundColor: 'rgba(224,242,254,0.35)',
                  padding: '16px',
                }}
              >
                <form onSubmit={handleSubmitRequest} style={{ display: 'grid', gap: '12px' }}>
                  <div
                    style={{
                      display: 'grid',
                      gap: '12px',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    }}
                  >
                    <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>
                      Preferred date
                      <input
                        type='date'
                        value={requestDate}
                        onChange={(event) => setRequestDate(event.target.value)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '12px',
                          border: '1px solid rgba(31,41,55,0.4)',
                          backgroundColor: '#2f3137',
                          color: '#f8fafc',
                          fontSize: '13px',
                          width: '100%',
                        }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>
                      Preferred time
                      <input
                        type='time'
                        value={requestTime}
                        onChange={(event) => setRequestTime(event.target.value)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '12px',
                          border: '1px solid rgba(31,41,55,0.4)',
                          backgroundColor: '#2f3137',
                          color: '#f8fafc',
                          fontSize: '13px',
                          width: '100%',
                        }}
                      />
                    </label>
                  </div>

                  <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>
                    Reason / details
                    <textarea
                      rows={3}
                      value={requestMessage}
                      onChange={(event) => setRequestMessage(event.target.value)}
                      placeholder='Briefly describe why you need to reschedule.'
                      style={{
                        padding: '12px',
                        borderRadius: '12px',
                        border: '1px solid rgba(148,163,184,0.4)',
                        backgroundColor: 'rgba(255,255,255,0.95)',
                        color: '#0f172a',
                        fontSize: '13px',
                        resize: 'vertical',
                      }}
                    />
                  </label>

                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button
                      type='submit'
                      disabled={isSubmitting}
                      style={{
                        padding: '10px 18px',
                        borderRadius: '12px',
                        border: 'none',
                        background: isSubmitting
                          ? '#94a3b8'
                          : 'linear-gradient(120deg, #0ea5e9, #0284c7)',
                        color: 'white',
                        fontWeight: 600,
                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        boxShadow: '0 10px 20px rgba(14,165,233,0.25)',
                      }}
                    >
                      {isSubmitting ? 'Sending...' : 'Submit request'}
                    </button>
                    <button
                      type='button'
                      onClick={() => setActiveSessionId(null)}
                      style={{
                        padding: '10px 18px',
                        borderRadius: '12px',
                        border: '1px solid rgba(148,163,184,0.4)',
                        backgroundColor: 'white',
                        color: '#475569',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}
          </article>
        );
      })}
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
                          <a
                            href={item.url || "#"}
                            target={item.url ? "_blank" : "_self"}
                            rel="noreferrer"
                            style={{ color: "#2563eb", textDecoration: "none" }}
                          >
                            {`${typeIcon} ${displayTitle}`}
                          </a>
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