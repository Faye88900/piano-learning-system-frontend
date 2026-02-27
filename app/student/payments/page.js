"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";

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
  const status = typeof enrollment.status === "string" ? enrollment.status.toLowerCase() : "";
  return (
    enrollment.paymentStatus === "paid" ||
    status === "paid" ||
    Boolean(enrollment.paidAt || enrollment.paymentReceiptUrl || enrollment.paymentIntentId)
  );
}

export default function StudentPaymentsPage() {
  const router = useRouter();
  const { sessionUser, loading } = useSessionUser();
  const currentUid = auth.currentUser?.uid;
  const [enrollments, setEnrollments] = useState([]);

  useEffect(() => {
    if (loading) return;
    if (!sessionUser) {
      router.push("/login");
      return;
    }
  }, [sessionUser, loading, router]);

  useEffect(() => {
    if (!sessionUser?.uid || !currentUid) {
      setEnrollments([]);
      return;
    }

    const q = query(
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
        setEnrollments(records);
      },
      (error) => {
        console.error("Failed to load enrollments", error);
        setEnrollments([]);
      }
    );

    return () => unsubscribe();
  }, [currentUid, sessionUser?.uid]);

  const paidCourses = useMemo(() => {
    return enrollments
      .map((entry) => {
        const course = courseCatalog.find((item) => item.id === entry.id);
        if (!course) return null;
        return { ...course, enrollment: entry };
      })
      .filter((course) => {
        if (!course) return false;
        return hasPaidAccess(course.enrollment);
      });
  }, [enrollments]);

  const studentPrimaryNav = [
    {
      id: "courses",
      label: "Course Feed",
      description: "Browse and enroll",
      icon: "📚",
      href: "/Dashboard",
    },
    {
      id: "materials",
      label: "Materials",
      description: "Downloads & links",
      icon: "📁",
      href: "/Dashboard",
    },
    {
      id: "attendance",
      label: "Schedule",
      description: "Lessons & attendance",
      icon: "📆",
      href: "/Dashboard",
    },
    {
      id: "progress",
      label: "Progress",
      description: "Milestones & notes",
      icon: "📈",
      href: "/Dashboard",
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

  if (loading || !sessionUser) {
    return null;
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, #eff6ff 0%, #dbeafe 30%, #f8fafc 100%)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        padding: "48px 24px",
      }}
    >
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
          activeTab="payments"
          onSelectTab={() => router.push("/Dashboard")}
          onSignOut={async () => {
            try {
              await signOut(auth);
            } catch (error) {
              console.error("Failed to sign out", error);
            } finally {
              router.push("/login");
            }
          }}
        />

        <div style={{ flex: "1 1 640px", minWidth: "0", display: "grid", gap: "24px" }}>
          <SectionCard
            title="Payment records"
            description="View paid invoices and download receipts."
          >
            <StudentPayments paidCourses={paidCourses} />
          </SectionCard>
        </div>
      </div>
    </main>
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

function SectionCard({ title, description, children }) {
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
      </div>
      {children && <div style={{ marginTop: "20px" }}>{children}</div>}
    </section>
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
