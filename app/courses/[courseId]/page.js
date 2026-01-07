"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc, where } from "firebase/firestore";
import { getCourseById } from "@/lib/courseCatalog";
import { db } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";

const paymentOptions = [
  { value: "pay_now", label: "Pay now (credit / debit card)", status: "Awaiting payment" },
];

export default function CourseDetailPage({ params }) {

  const router = useRouter();
  const { courseId } = use(params);
  const course = useMemo(() => getCourseById(courseId), [courseId]);
  
  const { sessionUser, loading } = useSessionUser();

  const [studentName, setStudentName] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [paymentOption, setPaymentOption] = useState(paymentOptions[0].value);
  const [existingEnrollment, setExistingEnrollment] = useState(null);
  const [firestoreMaterials, setFirestoreMaterials] = useState([]);
  const [backHover, setBackHover] = useState(false);

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const toastThemes = {
    success: {
      background: "#15803d",
      text: "#f0fdf4",
      title: "Thank you for registering for this course. You receive further details soon.",
    },
    error: { background: "#b91c1c", text: "#fee2e2", title: "Something went wrong" },
    info: { background: "#1d4ed8", text: "#dbeafe", title: "Notice" },
  };

  //用来显示提示讯息
  function showToast(nextToast) {
    setToast({ id: Date.now(), ...nextToast });

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    const duration = typeof nextToast?.duration === "number" ? nextToast.duration : 4000;
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, duration);
  }

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!sessionUser) {
      router.push("/login");
    }
  }, [sessionUser, loading, router]);

  
  //表单初始化
  useEffect(() => {
    if (!course || !sessionUser?.uid) {
      setExistingEnrollment(null);
      if (course) {
        setStudentName("");
        setTimeSlot(course.timeSlots?.[0]?.id ?? "");
        setPaymentOption(paymentOptions[0].value);
      }
      return;
    }

    //payment read time 
    const docRef = doc(db, "enrollments", `${sessionUser.uid}_${course.id}`);
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setExistingEnrollment(null);
          setStudentName("");
          setTimeSlot(course.timeSlots?.[0]?.id ?? "");
          setPaymentOption(paymentOptions[0].value);
          return;
        }

        const data = snapshot.data();
        setExistingEnrollment({ docId: snapshot.id, ...data });
        setStudentName(data.studentName ?? "");
        setTimeSlot(data.timeSlot ?? (course.timeSlots?.[0]?.id ?? ""));
        setPaymentOption(data.paymentOption ?? paymentOptions[0].value);
      },
      (error) => console.error("Failed to load enrollment", error)
    );

    return () => unsubscribe();
  }, [course, sessionUser?.uid]);

  useEffect(() => {
    if (!course) {
      setFirestoreMaterials([]);
      return;
    }

    const materialsQuery = query(
      collection(db, "materials"),
      where("courseId", "==", course.id),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      materialsQuery,
      (snapshot) => {
        const items = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === "function"
              ? data.createdAt.toDate().toISOString()
              : data.createdAt ?? null;
          return {
            id: docSnap.id,
            ...data,
            createdAt,
          };
        });
        setFirestoreMaterials(items);
      },
      (error) => {
        console.error("Failed to load course materials", error);
        setFirestoreMaterials([]);
      }
    );

    return () => unsubscribe();
  }, [course]);

  const activeToastTheme = toast ? toastThemes[toast.type ?? "info"] : null;

  if (loading) {
    return null;
  }

  if (!course) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f8fafc",
          fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
          padding: "20px",
        }}
      >
        <div
          style={{
            maxWidth: "520px",
            backgroundColor: "white",
            borderRadius: "16px",
            padding: "32px",
            boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0f172a" }}>Course not found</h1>
          <p style={{ marginTop: "12px", color: "#475569" }}>
            The course you are looking for may have been archived.
          </p>
          <Link
            href="/Dashboard"
            style={{
              display: "inline-flex",
              marginTop: "18px",
              padding: "10px 18px",
              backgroundColor: "#0f172a",
              color: "white",
              fontWeight: 600,
              borderRadius: "10px",
              textDecoration: "none",
            }}
          >
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const isStudent = sessionUser?.role === "student";
  const isEnrolled = Boolean(existingEnrollment);
  const isPaid =existingEnrollment?.paymentStatus === "paid" ||existingEnrollment?.status?.toLowerCase?.() === "paid";
  const isPaymentPending =existingEnrollment?.paymentStatus === "pending" ||existingEnrollment?.status?.toLowerCase?.() === "awaiting payment";
  const selectedSlot = course.timeSlots?.find((slot) => slot.id === timeSlot) ?? null;
  const selectedPayment = paymentOptions.find((option) => option.value === paymentOption);
  const enrollmentDocId = sessionUser?.uid && course ? `${sessionUser.uid}_${course.id}` : null;

  async function handleSubmit(event) {
    event.preventDefault();

    if (!isStudent || !sessionUser?.uid || !enrollmentDocId) {
      showToast({ type: "error", message: "Only student accounts can enrol in courses." });
      return;
    }

    if (!studentName.trim()) {
      showToast({ type: "error", message: "Please enter the student name." });
      return;
    }

    if (!timeSlot) {
      showToast({ type: "error", message: "Please choose a preferred time slot." });
      return;
    }

    const payNow = paymentOption === "pay_now" && !isPaid && !isPaymentPending;

    if (paymentOption === "pay_now" && isPaymentPending) {
      showToast({
        type: "info",
        message: "Payment is already in progress. Please complete or refresh after webhook updates.",
      });
      return;
    }

    try {
      await setDoc(doc(db, "enrollments", enrollmentDocId), {
        courseId: course.id,
        id: course.id,
        courseTitle: course.title,
        studentUid: sessionUser.uid,
        studentEmail: sessionUser.email ?? "",
        studentName: studentName.trim(),
        timeSlot: selectedSlot?.id ?? "",
        timeSlotLabel: selectedSlot?.label ?? "",
        paymentOption,
        paymentStatus: payNow ? "pending" : "not_required",
        status: selectedPayment?.status ?? "Pending",
        enrolledAt: new Date().toISOString(),
      });

      if (isPaid) {
        showToast({
          type: "info",
          message: "Enrollment is already paid. Details have been updated.",
        });
        return;
      }

      if (payNow) {
        const response = await fetch("/api/payments/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            courseId: course.id,
            enrollmentId: enrollmentDocId,
            studentEmail: sessionUser.email,
            studentName: studentName.trim(),
          }),
        });

        const data = await response.json();
        if (!response.ok || !data?.url) {
          showToast({
            type: "error",
            message: data?.error || "Unable to start payment. Please try again.",
          });
          return;
        }

        showToast({ type: "info", message: "Redirecting to payment..." });
        //go Stripe Checkout URL
        window.location.href = data.url;
        return;
      }

      showToast({
        type: "success",
        message: existingEnrollment ? "Your enrollment was updated." : "Your booking has been received.",
      });
    } catch (error) {
      console.error("Failed to submit enrollment", error);
      showToast({ type: "error", message: "Unable to save your enrollment. Please try again." });
    }
  }

  async function handleCancelEnrollment() {
    if (!enrollmentDocId) {
      return;
    }

    try {
      await deleteDoc(doc(db, "enrollments", enrollmentDocId));
      showToast({
        type: "info",
        message: "Your booking has been cancelled. Feel free to enroll again anytime.",
      });
      setTimeout(() => router.push("/Dashboard"), 1000);
    } catch (error) {
      console.error("Failed to cancel enrollment", error);
      showToast({ type: "error", message: "Unable to cancel this enrollment. Please try again." });
    }
  }

  const heroImage = course?.imageUrl ?? "";
  const teacherInitial = (course?.teacher?.[0] || "T").toUpperCase();
  const totalMaterials = firestoreMaterials.length;
  const scheduleOptionsCount = Array.isArray(course.timeSlots) ? course.timeSlots.length : 0;
  const heroStats = [
    {
      label: "Tuition",
      value: course?.tuition ? `$${course.tuition}` : "Contact studio",
    },
    {
      label: "Schedule",
      value: `${scheduleOptionsCount || 0} option${scheduleOptionsCount === 1 ? "" : "s"}`,
    },
    {
      label: "Materials",
      value: `${totalMaterials} shared`,
    },
  ];

  function scrollToEnrollmentCard() {
    if (typeof window === "undefined") return;
    const target = document.getElementById("enrollment-card");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, #eff6ff 0%, #dbeafe 40%, #f9fafb 100%)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        padding: "48px 24px",
        color: "#0f172a",
      }}
    >
      {toast && activeToastTheme && (
        <div style={{ position: "fixed", top: "24px", right: "24px", zIndex: 1000 }}>
          <div
            style={{
              position: "relative",
              minWidth: "260px",
              borderRadius: "16px",
              padding: "16px 20px",
              boxShadow: "0 20px 45px rgba(15, 23, 42, 0.2)",
              backgroundColor: activeToastTheme.background,
              color: activeToastTheme.text,
              display: "grid",
              gap: "6px",
            }}
          >
            <strong style={{ fontSize: "14px" }}>{toast.title ?? activeToastTheme.title}</strong>
            <span style={{ fontSize: "13px", lineHeight: 1.4 }}>{toast.message}</span>
            <button
              type="button"
              onClick={() => {
                if (toastTimerRef.current) {
                  clearTimeout(toastTimerRef.current);
                  toastTimerRef.current = null;
                }
                setToast(null);
              }}
              style={{
                position: "absolute",
                top: "10px",
                right: "14px",
                border: "none",
                background: "transparent",
                color: activeToastTheme.text,
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          display: "grid",
          gap: "24px",
        }}
      >
        <Link
          href="/Dashboard"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 12px",
            borderRadius: "999px",
            border: "1px solid #3b82f6",
            backgroundColor: backHover ? "rgba(59,130,246,0.08)" : "transparent",
            color: "#1d4ed8",
            fontSize: "13px",
            fontWeight: 700,
            textDecoration: "none",
            transition: "background-color 0.15s ease, box-shadow 0.15s ease",
            boxShadow: backHover ? "0 8px 18px rgba(37,99,235,0.18)" : "none",
            width: "fit-content",
            alignSelf: "flex-start",
          }}
          onMouseEnter={() => setBackHover(true)}
          onMouseLeave={() => setBackHover(false)}
        >
          <span style={{ fontSize: "14px" }}>←</span>
          <span>Back to dashboard</span>
        </Link>

        <section
          style={{
            backgroundColor: "white",
            borderRadius: "32px",
            padding: "32px",
            boxShadow: "0 35px 70px rgba(15, 23, 42, 0.12)",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.7fr) minmax(0, 1fr)",
            gap: "28px",
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              borderRadius: "24px",
              position: "relative",
              overflow: "hidden",
              minHeight: "260px",
              background: heroImage
                ? `url(${heroImage}) center/cover`
                : "linear-gradient(135deg, #0ea5e9, #2563eb)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: heroImage
                  ? "linear-gradient(160deg, rgba(15,23,42,0.2), rgba(15,23,42,0.05))"
                  : "linear-gradient(160deg, rgba(15,23,42,0.1), rgba(15,23,42,0.65))",
              }}
            />
            {!heroImage && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  color: "white",
                  gap: "10px",
                }}
              >
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "999px",
                    backgroundColor: "rgba(15,23,42,0.5)",
                    border: "1px solid rgba(255,255,255,0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "20px",
                  }}
                >
                  ?
                </div>
                <span style={{ fontSize: "13px", letterSpacing: "0.08em" }}>Course preview</span>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: "18px" }}>
            <div>
              <span
                style={{
                  display: "inline-flex",
                  padding: "6px 14px",
                  borderRadius: "999px",
                  backgroundColor: "rgba(37,99,235,0.12)",
                  color: "#1d4ed8",
                  fontWeight: 600,
                  fontSize: "12px",
                  letterSpacing: "0.08em",
                }}
              >
                {course.level}  {course.duration}
              </span>
              <h1
                style={{
                  marginTop: "14px",
                  fontSize: "32px",
                  fontWeight: 700,
                  color: "#0f172a",
                  lineHeight: 1.2,
                }}
              >
                {course.title}
              </h1>
              <p style={{ marginTop: "10px", color: "#475569", fontSize: "16px", lineHeight: 1.6 }}>
                {course.headline}
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "12px",
              }}
            >
              {heroStats.map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    borderRadius: "16px",
                    padding: "12px 14px",
                    border: "1px solid rgba(148,163,184,0.25)",
                    backgroundColor: "#f8fafc",
                    display: "grid",
                    gap: "4px",
                  }}
                >
                  <span style={{ fontSize: "11px", letterSpacing: "0.08em", color: "#94a3b8" }}>
                    {stat.label}
                  </span>
                  <strong style={{ color: "#0f172a", fontSize: "16px" }}>{stat.value}</strong>
                </div>
              ))}
              <button
                type="button"
                onClick={scrollToEnrollmentCard}
                style={{
                  justifySelf: "start",
                  marginTop: "8px",
                  padding: "12px 22px",
                  borderRadius: "999px",
                  border: "none",
                  background: "linear-gradient(120deg, #0ea5e9, #2563eb)",
                  color: "white",
                  fontWeight: 600,
                  boxShadow: "0 16px 30px rgba(37,99,235,0.25)",
                  cursor: "pointer",
                }}
              >
                Jump to enrollment
              </button>
            </div>
          </div>
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)",
            gap: "24px",
            alignItems: "flex-start",
          }}
        >
          <div style={{ display: "grid", gap: "24px" }}>
            <section
              style={{
                backgroundColor: "white",
                borderRadius: "24px",
                padding: "28px",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              }}
            >
              <h2 style={{ fontSize: "22px", fontWeight: 600, color: "#0f172a" }}>About this course</h2>
              <p style={{ marginTop: "14px", color: "#475569", lineHeight: 1.6 }}>{course.description}</p>
              {course.objectives?.length ? (
                <div style={{ marginTop: "18px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a", letterSpacing: "0.08em" }}>
                    Learning objectives
                  </h3>
                  <ul style={{ marginTop: "12px", marginLeft: "18px", color: "#475569", lineHeight: 1.6 }}>
                    {course.objectives.map((item) => (
                      <li key={item} style={{ marginBottom: "6px" }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section
              style={{
                backgroundColor: "white",
                borderRadius: "24px",
                padding: "28px",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
              }}
            >
              <h2 style={{ fontSize: "22px", fontWeight: 600, color: "#0f172a" }}>Course materials preview</h2>
              {firestoreMaterials.length === 0 ? (
                <p style={{ marginTop: "12px", color: "#94a3b8", fontSize: "14px" }}>
                  No materials have been shared for this course yet.
                </p>
              ) : (
                <div style={{ marginTop: "18px", display: "grid", gap: "12px" }}>
                  {firestoreMaterials.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        border: "1px solid rgba(148,163,184,0.3)",
                        borderRadius: "16px",
                        padding: "14px 16px",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "12px",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <p style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a", margin: 0 }}>
                          {item.title || item.label || "Shared resource"}
                        </p>
                        <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                          {item.type || "Resource"}
                          {item.description ? `  ${item.description}` : ""}
                        </span>
                      </div>
                      {item.url ? (
                        isEnrolled ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              padding: "8px 14px",
                              borderRadius: "999px",
                              border: "1px solid rgba(37,99,235,0.4)",
                              color: "#1d4ed8",
                              textDecoration: "none",
                              fontSize: "12px",
                              fontWeight: 600,
                            }}
                          >
                            Open
                          </a>
                        ) : (
                          <span
                            style={{
                              padding: "8px 14px",
                              borderRadius: "999px",
                              border: "1px solid rgba(239,68,68,0.4)",
                              color: "#b91c1c",
                              fontSize: "12px",
                              fontWeight: 600,
                              backgroundColor: "rgba(254,226,226,0.7)",
                            }}
                          >
                            Enroll to access
                          </span>
                        )
                      ) : (
                        <span style={{ fontSize: "12px", color: "#cbd5f5" }}>Link unavailable</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {course.quiz && (
              <section
                style={{
                  backgroundColor: "white",
                  borderRadius: "24px",
                  padding: "28px",
                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
                }}
              >
                <h2 style={{ fontSize: "22px", fontWeight: 600, color: "#0f172a" }}>Lesson check-in quiz</h2>
                <p style={{ marginTop: "12px", color: "#475569", lineHeight: 1.6 }}>{course.quiz.description}</p>
                <div
                  style={{
                    marginTop: "16px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "12px",
                    alignItems: "center",
                  }}
                >
                  {existingEnrollment ? (
                    <Link
                      href={`/courses/${course.id}/quiz`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "10px 20px",
                        borderRadius: "12px",
                        backgroundColor: "#0f172a",
                        color: "white",
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      {existingEnrollment.quizScore !== undefined && existingEnrollment.quizScore !== null
                        ? "Retake quiz"
                        : "Start quiz"}
                    </Link>
                  ) : (
                    <span style={{ fontSize: "13px", color: "#94a3b8" }}>Enroll first to unlock this quiz.</span>
                  )}

                  {existingEnrollment?.quizScore !== undefined && existingEnrollment.quizScore !== null && (
                    <span style={{ fontSize: "13px", color: "#1d4ed8", fontWeight: 600 }}>
                      Last score: {existingEnrollment.quizScore}%
                    </span>
                  )}
                </div>
              </section>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gap: "24px",
              position: "sticky",
              top: "32px",
              alignSelf: "start",
            }}
          >
            <section
              id="enrollment-card"
              style={{
                backgroundColor: "white",
                borderRadius: "24px",
                padding: "26px",
                boxShadow: "0 24px 50px rgba(37, 99, 235, 0.15)",
                display: "grid",
                gap: "16px",
              }}
            >
              <header>
                <h2 style={{ fontSize: "20px", fontWeight: 600, color: "#0f172a" }}>Enrollment</h2>
                <p style={{ marginTop: "6px", color: "#64748b", fontSize: "13px" }}>
                  Secure your seat and let us know your preferred schedule.
                </p>
              </header>

              <form onSubmit={handleSubmit} style={{ display: "grid", gap: "14px" }}>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>Student name</span>
                  <input
                    type="text"
                    value={studentName}
                    onChange={(event) => setStudentName(event.target.value)}
                    placeholder="Please enter the student's full name"
                    style={{
                      padding: "12px",
                      borderRadius: "12px",
                      border: "1px solid rgba(148,163,184,0.4)",
                      fontSize: "14px",
                      color: "#0f172a",
                      caretColor: "#0f172a",
                      backgroundColor: "#f8fafc",
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>Preferred time slot</span>
                  <select
                    value={timeSlot}
                    onChange={(event) => setTimeSlot(event.target.value)}
                    style={{
                      padding: "12px",
                      borderRadius: "12px",
                      border: "1px solid rgba(148,163,184,0.4)",
                      fontSize: "14px",
                      backgroundColor: "#f8fafc",
                      color: "#0f172a",
                    }}
                  >
                    <option value="" disabled>
                      Select a schedule option
                    </option>
                    {(course.timeSlots || []).map((slot) => (
                      <option key={slot.id} value={slot.id}>
                        {slot.label}
                      </option>
                    ))}
                  </select>
                </label>

                <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "10px" }}>
                  <legend style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a", marginBottom: "4px" }}>
                    Payment preference
                  </legend>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 12px",
                      borderRadius: "12px",
                      border: "2px solid rgba(14,165,233,0.8)",
                      backgroundColor: "rgba(224,242,254,0.6)",
                    }}
                  >
                    <input
                      type="radio"
                      name="payment-option"
                      value="pay_now"
                      checked
                      readOnly
                    />
                    <span style={{ fontSize: "13px", color: "#0f172a" }}>
                      {isPaid ? "Payment received" : isPaymentPending ? "Payment pending" : paymentOptions[0].label}
                    </span>
                  </label>
                </fieldset>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                  <button
                    type="submit"
                    disabled={!isStudent}
                    style={{
                      flex: "1 1 auto",
                      minWidth: "160px",
                      padding: "12px 18px",
                      borderRadius: "14px",
                      border: "none",
                      background: isStudent
                        ? "linear-gradient(120deg, #0ea5e9, #2563eb)"
                        : "#94a3b8",
                      color: "white",
                      fontWeight: 600,
                      cursor: isStudent ? "pointer" : "not-allowed",
                      boxShadow: isStudent ? "0 14px 28px rgba(37,99,235,0.25)" : "none",
                    }}
                  >
                    {existingEnrollment
                      ? isPaid
                        ? "Enrollment paid"
                        : isPaymentPending
                        ? "Payment pending"
                        : "Save enrollment"
                      : "Submit enrollment"}
                  </button>

                  {existingEnrollment && (
                    <button
                      type="button"
                      onClick={handleCancelEnrollment}
                      style={{
                        flex: "1 1 auto",
                        minWidth: "140px",
                        padding: "12px 18px",
                        borderRadius: "14px",
                        border: "1px solid rgba(239,68,68,0.8)",
                        backgroundColor: "white",
                        color: "#ef4444",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Cancel enrollment
                    </button>
                  )}
                </div>
              </form>

              {existingEnrollment && (
                <div style={{ display: "grid", gap: "4px", fontSize: "12px", color: "#475569" }}>
                  <span>Status: {existingEnrollment.status || "Pending"}</span>
                  <span>Payment: {existingEnrollment.paymentStatus || "pending"}</span>
                  <span style={{ color: "#94a3b8" }}>
                    Last updated: {new Date(existingEnrollment.enrolledAt).toLocaleString()}
                  </span>
                </div>
              )}
            </section>

            <section
              style={{
                backgroundColor: "white",
                borderRadius: "24px",
                padding: "24px",
                boxShadow: "0 18px 36px rgba(15, 23, 42, 0.08)",
                display: "grid",
                gap: "14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div
                  style={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "16px",
                    backgroundColor: "rgba(37,99,235,0.12)",
                    color: "#1d4ed8",
                    fontSize: "20px",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {teacherInitial}
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 600, color: "#0f172a" }}>{course.teacher}</p>
                  <span style={{ fontSize: "12px", color: "#94a3b8" }}>Lead instructor</span>
                </div>
              </div>
              <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.5 }}>
                Personalized coaching with detailed notes after every session. Reach out anytime via the dashboard messaging tools for additional guidance.
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
                <li style={{ fontSize: "13px", color: "#0f172a" }}>Level: {course.level}</li>
                <li style={{ fontSize: "13px", color: "#0f172a" }}>Duration: {course.duration}</li>
                <li style={{ fontSize: "13px", color: "#0f172a" }}>Tuition: ${course.tuition}</li>
              </ul>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {(course.tags || ["Piano technique", "Performance", "Theory"]).map((tag) => (
                  <span
                    key={tag}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "999px",
                      backgroundColor: "rgba(226,232,240,0.6)",
                      fontSize: "12px",
                      color: "#475569",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
