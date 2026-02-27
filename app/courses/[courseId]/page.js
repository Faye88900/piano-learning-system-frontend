"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {collection,deleteDoc,doc,onSnapshot,orderBy,query,serverTimestamp,setDoc,where,} from "firebase/firestore";
import { getCourseById } from "@/lib/courseCatalog";
import { db } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";

const paymentOptions = [
  { value: "pay_now", label: "Pay now (credit / debit card)", status: "Awaiting payment" },
];

function hasPaidAccess(enrollment) {
  if (!enrollment) return false;
  const status = typeof enrollment.status === "string" ? enrollment.status.toLowerCase() : "";
  return (
    enrollment.paymentStatus === "paid" ||
    status === "paid" ||
    Boolean(enrollment.paidAt || enrollment.paymentReceiptUrl || enrollment.paymentIntentId)
  );
}

function parseDurationToWeeks(duration) {
  if (typeof duration !== "string") return 0;
  const weekMatch = duration.match(/(\d+)\s*week/i);
  if (weekMatch) return Number(weekMatch[1]) || 0;
  const monthMatch = duration.match(/(\d+)\s*month/i);
  if (monthMatch) return (Number(monthMatch[1]) || 0) * 4;
  return 0;
}

function parseTimeToMinutes(value) {
  if (typeof value !== "string" || !value.includes(":")) return null;
  const [h, m] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function getAverageSlotHours(timeSlots) {
  if (!Array.isArray(timeSlots) || !timeSlots.length) return 1;
  const durations = timeSlots
    .map((slot) => {
      const start = parseTimeToMinutes(slot?.startTime);
      const end = parseTimeToMinutes(slot?.endTime);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return (end - start) / 60;
    })
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!durations.length) return 1;
  return durations.reduce((sum, value) => sum + value, 0) / durations.length;
}

function buildFallbackSyllabus(course, averageSlotHours = 1) {
  const objectives = Array.isArray(course?.objectives) ? course.objectives.filter(Boolean) : [];
  if (!objectives.length) return [];

  return objectives.map((objective, index) => {
    const week = index + 1;
    const liveHours = Math.max(1, Math.round(averageSlotHours * 10) / 10);
    return {
      id: `fallback-${course?.id || "course"}-${week}`,
      weekLabel: `Week ${week}`,
      title: objective,
      duration: `${liveHours}h live + ${Math.max(2, liveHours + 1)}h practice`,
      formats: ["Live lesson", "Guided practice", "Weekly assignment"],
      practiceTask: `Practice focus: ${objective}`,
    };
  });
}

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
  const [courseEnrollmentRecords, setCourseEnrollmentRecords] = useState([]);
  const [courseReviews, setCourseReviews] = useState([]);
  const [myReview, setMyReview] = useState(null);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [backHover, setBackHover] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState(0);

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

  useEffect(() => {
    if (!course?.id) {
      setCourseEnrollmentRecords([]);
      return;
    }

    const enrollmentsQuery = query(
      collection(db, "enrollments"),
      where("courseId", "==", course.id)
    );
    const unsubscribe = onSnapshot(
      enrollmentsQuery,
      (snapshot) => {
        const records = snapshot.docs.map((docSnap) => ({ docId: docSnap.id, ...docSnap.data() }));
        setCourseEnrollmentRecords(records);
      },
      (error) => {
        console.error("Failed to load course enrollments for trust signals", error);
        setCourseEnrollmentRecords([]);
      }
    );

    return () => unsubscribe();
  }, [course?.id]);

  useEffect(() => {
    if (!course?.id) {
      setCourseReviews([]);
      return;
    }

    const reviewsQuery = query(
      collection(db, "courseReviews"),
      where("courseId", "==", course.id)
    );
    const unsubscribe = onSnapshot(
      reviewsQuery,
      (snapshot) => {
        const records = snapshot.docs.map((docSnap) => {
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
            docId: docSnap.id,
            ...data,
            createdAt,
            updatedAt,
          };
        });
        setCourseReviews(records);
      },
      (error) => {
        console.error("Failed to load course reviews", error);
        setCourseReviews([]);
      }
    );

    return () => unsubscribe();
  }, [course?.id]);

  useEffect(() => {
    if (!course?.id || !sessionUser?.uid) {
      setMyReview(null);
      setReviewRating(0);
      setReviewComment("");
      return;
    }

    const reviewDocId = `${sessionUser.uid}_${course.id}`;
    const reviewRef = doc(db, "courseReviews", reviewDocId);
    const unsubscribe = onSnapshot(
      reviewRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setMyReview(null);
          setReviewRating(0);
          setReviewComment("");
          return;
        }
        const data = snapshot.data();
        setMyReview({ docId: snapshot.id, ...data });
        setReviewRating(
          typeof data.rating === "number" ? Math.max(1, Math.min(5, Math.round(data.rating))) : 0
        );
        setReviewComment(typeof data.comment === "string" ? data.comment : "");
      },
      (error) => {
        console.error("Failed to load my course review", error);
        setMyReview(null);
      }
    );

    return () => unsubscribe();
  }, [course?.id, sessionUser?.uid]);

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
  const isPaid = hasPaidAccess(existingEnrollment);
  const isPaymentPending =
  existingEnrollment?.paymentStatus === "pending" ||
  existingEnrollment?.status?.toLowerCase?.() === "awaiting payment";
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
      const nextPaymentStatus = isPaid
        ? "paid"
        : payNow
        ? "pending"
        : existingEnrollment?.paymentStatus ?? "not_required";
      const nextStatus = isPaid
        ? "Paid"
        : payNow
        ? selectedPayment?.status ?? "Awaiting payment"
        : existingEnrollment?.status ?? "Pending";

      await setDoc(
        doc(db, "enrollments", enrollmentDocId),
        {
          courseId: course.id,
          id: course.id,
          courseTitle: course.title,
          studentUid: sessionUser.uid,
          studentEmail: sessionUser.email ?? "",
          studentName: studentName.trim(),
          timeSlot: selectedSlot?.id ?? "",
          timeSlotLabel: selectedSlot?.label ?? "",
          timeSlotDay: selectedSlot?.dayOfWeek ?? "",
          timeSlotStartTime: selectedSlot?.startTime ?? "",
          timeSlotEndTime: selectedSlot?.endTime ?? "",
          paymentOption,
          paymentStatus: nextPaymentStatus,
          status: nextStatus,
          meetingLink: existingEnrollment?.meetingLink ?? "",
          enrolledAt: new Date().toISOString(),
        },
        { merge: true }
      );

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

  async function handleSubmitReview(event) {
    event.preventDefault();
    if (!sessionUser?.uid || !course?.id) {
      showToast({ type: "error", message: "Please sign in before submitting a rating." });
      return;
    }
    if (!isPaid) {
      showToast({ type: "error", message: "Complete payment to rate this course." });
      return;
    }
    if (!reviewRating || reviewRating < 1 || reviewRating > 5) {
      showToast({ type: "error", message: "Please choose a rating between 1 and 5 stars." });
      return;
    }

    setSubmittingReview(true);
    const reviewDocId = `${sessionUser.uid}_${course.id}`;
    try {
      await setDoc(
        doc(db, "courseReviews", reviewDocId),
        {
          courseId: course.id,
          courseTitle: course.title,
          studentUid: sessionUser.uid,
          studentEmail: sessionUser.email ?? "",
          studentName:
            sessionUser.profileName ||
            studentName?.trim() ||
            sessionUser.email ||
            "Student",
          rating: reviewRating,
          comment: reviewComment.trim(),
          createdAt: myReview?.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      showToast({
        type: "success",
        message: myReview ? "Your rating has been updated." : "Thanks for rating this course!",
      });
    } catch (error) {
      console.error("Failed to save course review", error);
      const isPermissionDenied = error?.code === "permission-denied";
      showToast({
        type: "error",
        message: isPermissionDenied
          ? "Course review write is blocked by Firestore rules. Please update and publish rules first."
          : "Unable to save your rating. Please try again.",
      });
    } finally {
      setSubmittingReview(false);
    }
  }

  const heroImage = course?.imageUrl ?? "";
  const teacherInitial = (course?.teacher?.[0] || "T").toUpperCase();
  const totalMaterials = firestoreMaterials.length;
  const scheduleOptionsCount = Array.isArray(course.timeSlots) ? course.timeSlots.length : 0;
  const learnerCount = (() => {
    const keys = new Set();
    for (const entry of courseEnrollmentRecords) {
      const key = entry?.studentUid || entry?.studentEmail || entry?.docId;
      if (key) keys.add(key);
    }
    return keys.size;
  })();
  const normalizedRatings = courseReviews
    .map((record) => Number(record?.rating))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 5);
  const ratingCount = normalizedRatings.length;
  const averageRating =
    ratingCount > 0
      ? Number(
          (normalizedRatings.reduce((sum, value) => sum + value, 0) / ratingCount).toFixed(1)
        )
      : null;
  const satisfactionRate =
    ratingCount > 0
      ? Math.round(
          (normalizedRatings.filter((value) => value >= 4).length / ratingCount) * 100
        )
      : null;
  const averageSlotHours = getAverageSlotHours(course?.timeSlots);
  const totalHours = (() => {
    const weeks = parseDurationToWeeks(course?.duration);
    if (!weeks) return null;
    const computed = weeks * averageSlotHours;
    return Math.round(computed * 10) / 10;
  })();
  const trustSignals = [
    {
      label: "Rating",
      value: averageRating ? `${averageRating} / 5` : "No ratings yet",
      detail: `${ratingCount} review${ratingCount === 1 ? "" : "s"}`,
    },
    {
      label: "Enrollments",
      value: learnerCount ? `${learnerCount} learners` : "New course",
      detail: learnerCount ? "Live count" : "Be among first learners",
    },
    {
      label: "Satisfaction",
      value: Number.isFinite(satisfactionRate) ? `${satisfactionRate}%` : "No ratings yet",
      detail: ratingCount ? "4-5 star learner ratings" : "Submit first rating to unlock",
    },
    {
      label: "Total hours",
      value: totalHours ? `${totalHours} h` : "TBD",
      detail: totalHours ? "Estimated guided time" : "Based on weekly schedule",
    },
  ];
  const skillsYouGain = (() => {
    const tags = Array.isArray(course?.tags) ? course.tags.filter(Boolean) : [];
    if (tags.length) return tags.slice(0, 8);

    const objectives = Array.isArray(course?.objectives)
      ? course.objectives.filter(Boolean).slice(0, 6)
      : [];
    if (objectives.length) return objectives;

    return ["Piano technique", "Sight reading", "Rhythm control", "Musical expression"];
  })();
  const detailsToKnow = [
    { label: "Level", value: course?.level || "All levels" },
    { label: "Duration", value: course?.duration || "Flexible" },
    {
      label: "Live schedule",
      value: `${scheduleOptionsCount || 0} option${scheduleOptionsCount === 1 ? "" : "s"}`,
    },
    {
      label: "Check-in quiz",
      value: course?.quiz ? `${(course.quiz.questions || []).length} question(s)` : "Not included",
    },
    {
      label: "Shared materials",
      value: totalMaterials ? `${totalMaterials} resource(s)` : "Added by instructor over time",
    },
    {
      label: "Tuition",
      value: course?.tuition ? `$${course.tuition}` : "Contact studio",
    },
  ];
  const syllabusModules = (
    Array.isArray(course?.syllabus) && course.syllabus.length
      ? course.syllabus
      : buildFallbackSyllabus(course, averageSlotHours)
  ).map((module, index) => ({
    id: module?.id || `module-${index + 1}`,
    weekLabel: module?.weekLabel || `Module ${index + 1}`,
    title: module?.title || `Module ${index + 1}`,
    duration: module?.duration || `${Math.round(averageSlotHours * 10) / 10}h live`,
    formats: Array.isArray(module?.formats) ? module.formats.filter(Boolean) : [],
    practiceTask: module?.practiceTask || "Practice this module and submit your weekly progress.",
  }));
  const faqItems = [
    {
      question: "How are lesson times arranged?",
      answer:
        scheduleOptionsCount > 0
          ? `This course currently has ${scheduleOptionsCount} schedule option(s). Choose your preferred slot during enrollment, and you can review upcoming sessions from the Attendance tab in your dashboard.`
          : "Lesson time is coordinated by your teacher after enrollment.",
    },
    {
      question: "When do I get access to materials and quiz?",
      answer:
        "Course materials and the lesson check-in quiz are available after enrollment. Some resources are unlocked after payment is completed.",
    },
    {
      question: "Can I request a make-up class?",
      answer:
        "Yes. If you cannot attend, use the Attendance section in your dashboard to submit a reschedule request with your preferred date and time.",
    },
    {
      question: "What happens if payment is cancelled?",
      answer:
        "No charge is made. Your enrollment remains saved, and you can return to this page and retry checkout at any time.",
    },
    {
      question: "Is this course suitable for my level?",
      answer: `This class is marked as ${course?.level || "All levels"}. Check the learning objectives and skills section above to confirm it fits your current goals.`,
    },
  ];
  const recentReviews = [...courseReviews]
    .filter((record) => typeof record.comment === "string" && record.comment.trim())
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, 3);
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

  const studentRatingsSection = (
<section
              style={{
                backgroundColor: "white",
                borderRadius: "24px",
                padding: "28px",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
                display: "grid",
                gap: "14px",
              }}
            >
              <h2 style={{ fontSize: "22px", fontWeight: 600, color: "#0f172a" }}>
                Student ratings
              </h2>
              <p style={{ margin: 0, fontSize: "13px", color: "#475569" }}>
                {ratingCount
                  ? `${ratingCount} learner rating${ratingCount > 1 ? "s" : ""} submitted`
                  : "No ratings yet. Paid learners can submit the first review."}
              </p>

              <form onSubmit={handleSubmitReview} style={{ display: "grid", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  {[1, 2, 3, 4, 5].map((value) => {
                    const active = reviewRating >= value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setReviewRating(value)}
                        disabled={!isPaid}
                        aria-label={`Rate ${value} star${value > 1 ? "s" : ""}`}
                        style={{
                          border: "none",
                          background: "transparent",
                          fontSize: "24px",
                          lineHeight: 1,
                          color: active ? "#f59e0b" : "#cbd5e1",
                          cursor: isPaid ? "pointer" : "not-allowed",
                          padding: 0,
                        }}
                      >
                        {"\u2605"}
                      </button>
                    );
                  })}
                  <span style={{ fontSize: "13px", color: "#334155", marginLeft: "4px" }}>
                    {reviewRating ? `${reviewRating}/5` : "Select rating"}
                  </span>
                </div>

                <textarea
                  rows={3}
                  value={reviewComment}
                  onChange={(event) => setReviewComment(event.target.value)}
                  placeholder="Share a short review (optional)"
                  disabled={!isPaid}
                  style={{
                    borderRadius: "12px",
                    border: "1px solid rgba(148,163,184,0.4)",
                    padding: "12px",
                    fontSize: "13px",
                    color: "#0f172a",
                    backgroundColor: isPaid ? "white" : "rgba(248,250,252,0.8)",
                    resize: "vertical",
                  }}
                />

                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <button
                    type="submit"
                    disabled={!isPaid || submittingReview}
                    style={{
                      padding: "10px 16px",
                      borderRadius: "12px",
                      border: "none",
                      background: !isPaid || submittingReview
                        ? "#94a3b8"
                        : "linear-gradient(120deg, #0ea5e9, #2563eb)",
                      color: "white",
                      fontWeight: 600,
                      cursor: !isPaid || submittingReview ? "not-allowed" : "pointer",
                    }}
                  >
                    {submittingReview ? "Saving..." : myReview ? "Update rating" : "Submit rating"}
                  </button>
                  {!isPaid && (
                    <span style={{ fontSize: "12px", color: "#b45309" }}>
                      Complete payment to rate this course.
                    </span>
                  )}
                </div>
              </form>

              {recentReviews.length > 0 && (
                <div style={{ display: "grid", gap: "10px", marginTop: "6px" }}>
                  {recentReviews.map((item) => (
                    <article
                      key={item.docId}
                      style={{
                        border: "1px solid rgba(226,232,240,0.9)",
                        borderRadius: "12px",
                        padding: "12px",
                        backgroundColor: "#f8fafc",
                        display: "grid",
                        gap: "6px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
                        <strong style={{ fontSize: "13px", color: "#0f172a" }}>
                          {item.studentName || item.studentEmail || "Student"}
                        </strong>
                        <span style={{ fontSize: "12px", color: "#f59e0b", fontWeight: 700 }}>
                          {"\u2605".repeat(Math.max(0, Math.min(5, Number(item.rating) || 0))) || "No rating"}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: "13px", color: "#475569", lineHeight: 1.5 }}>
                        {item.comment}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>
  );

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
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: "10px",
              }}
            >
              {trustSignals.map((item) => (
                <div
                  key={item.label}
                  style={{
                    borderRadius: "14px",
                    border: "1px solid rgba(148,163,184,0.3)",
                    backgroundColor: "#f8fafc",
                    padding: "10px 12px",
                    display: "grid",
                    gap: "4px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {item.label}
                  </span>
                  <strong style={{ fontSize: "15px", color: "#0f172a" }}>{item.value}</strong>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>{item.detail}</span>
                </div>
              ))}
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
                display: "grid",
                gap: "18px",
              }}
            >
              <h2 style={{ fontSize: "22px", fontWeight: 600, color: "#0f172a" }}>
                What you&apos;ll gain
              </h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: "18px",
                }}
              >
                <div
                  style={{
                    border: "1px solid rgba(148,163,184,0.28)",
                    borderRadius: "18px",
                    padding: "16px",
                    backgroundColor: "#f8fafc",
                    display: "grid",
                    gap: "12px",
                  }}
                >
                  <h3
                    style={{
                      margin: 0,
                      fontSize: "13px",
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      color: "#0f172a",
                      textTransform: "uppercase",
                    }}
                  >
                    Skills you&apos;ll practice
                  </h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {skillsYouGain.map((skill) => (
                      <span
                        key={skill}
                        style={{
                          padding: "7px 12px",
                          borderRadius: "999px",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#1d4ed8",
                          backgroundColor: "rgba(37,99,235,0.1)",
                          border: "1px solid rgba(37,99,235,0.2)",
                        }}
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid rgba(148,163,184,0.28)",
                    borderRadius: "18px",
                    padding: "16px",
                    backgroundColor: "#f8fafc",
                    display: "grid",
                    gap: "10px",
                  }}
                >
                  <h3
                    style={{
                      margin: 0,
                      fontSize: "13px",
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      color: "#0f172a",
                      textTransform: "uppercase",
                    }}
                  >
                    Details to know
                  </h3>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
                    {detailsToKnow.map((item) => (
                      <li
                        key={item.label}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "10px",
                          borderBottom: "1px solid rgba(226,232,240,0.9)",
                          paddingBottom: "8px",
                          fontSize: "13px",
                          color: "#334155",
                        }}
                      >
                        <span>{item.label}</span>
                        <strong style={{ color: "#0f172a", textAlign: "right" }}>{item.value}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section
              style={{
                backgroundColor: "white",
                borderRadius: "24px",
                padding: "28px",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
                display: "grid",
                gap: "14px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <h2 style={{ fontSize: "22px", fontWeight: 600, color: "#0f172a" }}>
                  Course syllabus
                </h2>
                <span
                  style={{
                    alignSelf: "center",
                    fontSize: "12px",
                    color: "#64748b",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                  }}
                >
                  {syllabusModules.length} module{syllabusModules.length === 1 ? "" : "s"}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: "13px", color: "#475569" }}>
                Follow this week-by-week path to track learning goals, lesson formats, and home practice tasks.
              </p>

              <div style={{ display: "grid", gap: "10px" }}>
                {syllabusModules.map((module) => (
                  <article
                    key={module.id}
                    style={{
                      border: "1px solid rgba(203,213,225,0.9)",
                      borderRadius: "14px",
                      padding: "14px",
                      backgroundColor: "#f8fafc",
                      display: "grid",
                      gap: "10px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                      <span
                        style={{
                          padding: "4px 10px",
                          borderRadius: "999px",
                          backgroundColor: "rgba(37,99,235,0.12)",
                          color: "#1d4ed8",
                          fontSize: "11px",
                          fontWeight: 700,
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                        }}
                      >
                        {module.weekLabel}
                      </span>
                      <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>
                        {module.duration}
                      </span>
                    </div>

                    <h3 style={{ margin: 0, fontSize: "15px", color: "#0f172a", fontWeight: 600 }}>
                      {module.title}
                    </h3>

                    {module.formats.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {module.formats.map((format) => (
                          <span
                            key={`${module.id}-${format}`}
                            style={{
                              padding: "5px 10px",
                              borderRadius: "999px",
                              border: "1px solid rgba(148,163,184,0.4)",
                              backgroundColor: "white",
                              fontSize: "11px",
                              color: "#334155",
                              fontWeight: 600,
                            }}
                          >
                            {format}
                          </span>
                        ))}
                      </div>
                    )}

                    <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: "#475569" }}>
                      <strong style={{ color: "#0f172a" }}>Practice task:</strong> {module.practiceTask}
                    </p>
                  </article>
                ))}
              </div>
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
                        isPaid ? (
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
                            Payment required
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
                  {isPaid ? (
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
                      {existingEnrollment?.quizScore !== undefined && existingEnrollment?.quizScore !== null
                        ? "Retake quiz"
                        : "Start quiz"}
                    </Link>
                  ) : isEnrolled ? (
                    <span style={{ fontSize: "13px", color: "#b45309" }}>
                      Complete payment to unlock this quiz.
                    </span>
                  ) : (
                    <span style={{ fontSize: "13px", color: "#94a3b8" }}>
                      Enroll first to unlock this quiz.
                    </span>
                  )}

                  {existingEnrollment?.quizScore !== undefined && existingEnrollment.quizScore !== null && (
                    <span style={{ fontSize: "13px", color: "#1d4ed8", fontWeight: 600 }}>
                      Last score: {existingEnrollment.quizScore}%
                    </span>
                  )}
                </div>
              </section>
            )}

            <section
              style={{
                backgroundColor: "white",
                borderRadius: "24px",
                padding: "28px",
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
                display: "grid",
                gap: "14px",
              }}
            >
              <h2 style={{ fontSize: "22px", fontWeight: 600, color: "#0f172a" }}>
                Frequently asked questions
              </h2>
              <div style={{ display: "grid", gap: "10px" }}>
                {faqItems.map((item, index) => {
                  const isOpen = openFaqIndex === index;
                  return (
                    <article
                      key={item.question}
                      style={{
                        border: "1px solid rgba(203,213,225,0.9)",
                        borderRadius: "14px",
                        backgroundColor: isOpen ? "rgba(59,130,246,0.06)" : "white",
                        overflow: "hidden",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenFaqIndex((prev) => (prev === index ? -1 : index))}
                        aria-expanded={isOpen}
                        style={{
                          width: "100%",
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "14px 16px",
                          gap: "12px",
                          textAlign: "left",
                        }}
                      >
                        <span style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>
                          {item.question}
                        </span>
                        <span style={{ fontSize: "16px", color: "#1d4ed8", lineHeight: 1 }}>
                          {isOpen ? "-" : "+"}
                        </span>
                      </button>
                      {isOpen && (
                        <p
                          style={{
                            margin: 0,
                            padding: "0 16px 14px",
                            fontSize: "13px",
                            lineHeight: 1.6,
                            color: "#475569",
                          }}
                        >
                          {item.answer}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
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
            {studentRatingsSection}
          </div>
        </div>
      </div>
    </main>
  );
}
