"use client";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { getCourseById } from "@/lib/courseCatalog";
import { db } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";

function hasPaidAccess(enrollment) {
  if (!enrollment) return false;
  const status = typeof enrollment.status === "string" ? enrollment.status.toLowerCase() : "";
  return (
    enrollment.paymentStatus === "paid" ||
    status === "paid" ||
    Boolean(enrollment.paidAt || enrollment.paymentReceiptUrl || enrollment.paymentIntentId)
  );
}

//初始化测试
function getInitialAnswers(course) {
  if (!course?.quiz?.questions) return {};
  return course.quiz.questions.reduce((acc, question) => {
    acc[question.id] = "";
    return acc;
  }, {});
}

export default function CourseQuizPage({ params }) {

  const router = useRouter();
  const { courseId } = use(params);
  const course = useMemo(() => getCourseById(courseId), [courseId]);
  const { sessionUser, loading: authLoading } = useSessionUser();
  const [answers, setAnswers] = useState(() => getInitialAnswers(course));
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(null);
  const [results, setResults] = useState([]); 
  const [enrollment, setEnrollment] = useState(null);
  const [enrollmentReady, setEnrollmentReady] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!sessionUser) {
      router.push("/login");
    }
  }, [sessionUser, authLoading, router]);

  useEffect(() => {
    if (!course) {
      return;
    }
    setAnswers(getInitialAnswers(course));
  }, [courseId, course]);

  //学生能不能进到quiz page 
  useEffect(() => {
    if (!course || !sessionUser?.uid) {
      setEnrollment(null);
      setEnrollmentReady(true);
      return;
    }

    setEnrollmentReady(false);
    const docRef = doc(db, "enrollments", `${sessionUser.uid}_${course.id}`);
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setEnrollment(null);
          setScore(null);
        } else {
          const data = snapshot.data();
          setEnrollment({ docId: snapshot.id, ...data });
          setScore(
            typeof data.quizScore === "number" ? data.quizScore : null
          );
        }
        setEnrollmentReady(true);
      },
      (error) => {
        console.error("Failed to subscribe to enrollment", error);
        setEnrollment(null);
        setEnrollmentReady(true);
      }
    );

    return () => unsubscribe();
  }, [course, sessionUser?.uid]);

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
          <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0f172a" }}>
            Quiz not available
          </h1>
          <p style={{ marginTop: "12px", color: "#475569" }}>
            The requested course quiz could not be found.
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
            Return to home
          </Link>
        </div>
      </main>
    );
  }

  if (authLoading || !enrollmentReady) {
    return null;
  }

  if (!enrollment) {
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
          <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0f172a" }}>
            Please complete the registration first.
          </h1>
          <p style={{ marginTop: "12px", color: "#475569" }}>
            Once you register, you can unlock the test and get your scores.
          </p>
          <Link
            href={`/courses/${course.id}`}
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
            Return to Course Introduction
          </Link>
        </div>
      </main>
    );
  }

  const isPaid = hasPaidAccess(enrollment);

  if (!isPaid) {
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
          <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0f172a" }}>
            Payment required to unlock the quiz.
          </h1>
          <p style={{ marginTop: "12px", color: "#475569" }}>
            Complete your payment to access this course quiz.
          </p>
          <Link
            href={`/courses/${course.id}`}
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
            Return to Course Introduction
          </Link>
        </div>
      </main>
    );
  }

  const quiz = course.quiz;
  const totalQuestions = quiz?.questions?.length ?? 0;

    //record student answers
  function handleAnswerChange(questionId, optionId) {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!quiz?.questions?.length) {
      return;
    }

  //评分 + 生成结果数据 + 存 Firebase + 存本地历史
    const answersSnapshot = { ...answers };
    const evaluation = quiz.questions.map((question) => {
    const selected = answersSnapshot[question.id];
    const correctOption = question.options.find((option) => option.isCorrect);
    const isCorrect = selected === (correctOption?.id ?? null);
      return {
        questionId: question.id,
        selected,
        correctOptionId: correctOption?.id ?? null,
        isCorrect,
        explanation: question.explanation,
      };
    });

    const correctCount = evaluation.filter((item) => item.isCorrect).length;
    const computedScore = Math.round((correctCount / quiz.questions.length) * 100);

    setSubmitted(true);
    setScore(computedScore);
    setResults(evaluation);

    try {
      await updateDoc(doc(db, "enrollments", enrollment.docId), {
        quizScore: computedScore,
        quizCompletedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to update quiz score", error);
    }

    //retake quiz 
    try {
      const historyStore = JSON.parse(localStorage.getItem("quizHistory") || "{}");
      const courseHistory = Array.isArray(historyStore[course.id]) ? historyStore[course.id] : [];
      const record = {
        score: computedScore,
        completedAt: new Date().toISOString(),
        answers: answersSnapshot,
      };
      historyStore[course.id] = [...courseHistory, record];
      localStorage.setItem("quizHistory", JSON.stringify(historyStore));
    } catch (error) {
      console.error("Failed to record quiz history", error);
    }
  }

  function handleRetake() {
    setAnswers(getInitialAnswers(course));
    setSubmitted(false);
    setScore(null);
    setResults([]);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 45%, #312e81 100%)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        padding: "48px 20px",
        color: "#0f172a",
      }}
    >
      <div
        style={{
          maxWidth: "960px",
          margin: "0 auto",
          backgroundColor: "rgba(248, 250, 252, 0.97)",
          borderRadius: "28px",
          boxShadow: "0 30px 60px rgba(15, 23, 42, 0.35)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "40px 48px",
            borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
            display: "grid",
            gap: "12px",
            background:
              "radial-gradient(circle at top right, rgba(59,130,246,0.18), transparent 55%), #f8fafc",
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
              backgroundColor: "transparent",
              color: "#1d4ed8",
              fontSize: "13px",
              fontWeight: 700,
              textDecoration: "none",
              transition: "background-color 0.15s ease, box-shadow 0.15s ease",
              width: "fit-content",
              alignSelf: "flex-start",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.backgroundColor = "rgba(59,130,246,0.08)";
              event.currentTarget.style.boxShadow = "0 8px 18px rgba(37,99,235,0.18)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.backgroundColor = "transparent";
              event.currentTarget.style.boxShadow = "none";
            }}
          >
            <span style={{ fontSize: "14px" }}>←</span>
            <span>Back to dashboard</span>
          </Link>
          <div>
            <span
              style={{
                display: "inline-block",
                padding: "4px 12px",
                borderRadius: "999px",
                backgroundColor: "rgba(59, 130, 246, 0.12)",
                color: "#1d4ed8",
                fontWeight: 600,
                fontSize: "12px",
                letterSpacing: "0.14em",
              }}
            >
              COURSE QUIZ
            </span>
            <h1
              style={{
                marginTop: "16px",
                fontSize: "30px",
                fontWeight: 700,
                color: "#0f172a",
              }}
            >
              {quiz.title}
            </h1>
            <p style={{ marginTop: "10px", color: "#475569", fontSize: "15px", maxWidth: "640px" }}>
              {quiz.description}
            </p>
          </div>
          <div style={{ display: "flex", gap: "18px", flexWrap: "wrap", fontSize: "13px", color: "#475569" }}>
            <span>Total questions: {totalQuestions}</span>
            {score !== null && (
              <span style={{ color: score >= 80 ? "#15803d" : "#b91c1c", fontWeight: 600 }}>
                Latest attempt: {score}%
              </span>
            )}
          </div>
        </header>

        <form onSubmit={handleSubmit} style={{ padding: "40px 48px", display: "grid", gap: "24px" }}>
          {(quiz.questions || []).map((question) => {
            const evaluation = results.find((item) => item.questionId === question.id);
            const selected = answers[question.id];
            const correctOption = question.options.find((option) => option.isCorrect);
            const hasSubmitted = submitted && evaluation;
            return (
              <article
                key={question.id}
                style={{
                  backgroundColor: "white",
                  borderRadius: "18px",
                  padding: "24px",
                  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.08)",
                  border:
                    hasSubmitted && evaluation.isCorrect
                      ? "1px solid rgba(22, 163, 74, 0.35)"
                      : hasSubmitted
                      ? "1px solid rgba(239, 68, 68, 0.35)"
                      : "1px solid rgba(15, 23, 42, 0.06)",
                }}
              >
                <h2 style={{ fontSize: "17px", fontWeight: 600, color: "#0f172a", marginBottom: "14px" }}>
                  {question.prompt}
                </h2>
                <div style={{ display: "grid", gap: "12px" }}>
                  {question.options.map((option) => {
                    const isSelected = selected === option.id;
                    const isCorrectOption = option.isCorrect;
                    const highlight = submitted
                      ? isCorrectOption
                        ? "rgba(22, 163, 74, 0.12)"
                        : isSelected
                        ? "rgba(239, 68, 68, 0.12)"
                        : "white"
                      : "white";
                    return (
                      <label
                        key={option.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "12px 14px",
                          borderRadius: "10px",
                          border: isSelected
                            ? "2px solid #2563eb"
                            : "1px solid rgba(148, 163, 184, 0.4)",
                          backgroundColor: highlight,
                          cursor: submitted ? "default" : "pointer",
                        }}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          value={option.id}
                          checked={isSelected}
                          disabled={submitted}
                          onChange={() => handleAnswerChange(question.id, option.id)}
                        />
                        <span style={{ fontSize: "14px", color: "#0f172a" }}>{option.label}</span>
                      </label>
                    );
                  })}
                </div>
                {hasSubmitted && (
                  <p style={{ marginTop: "16px", fontSize: "13px", color: "#475569" }}>
                    Explanation: {evaluation.explanation}
                  </p>
                )}
              </article>
            );
          })}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
            <button
              type="submit"
              disabled={submitted}
              style={{
                padding: "14px 22px",
                borderRadius: "12px",
                border: "none",
                background: submitted
                  ? "linear-gradient(120deg, #94a3b8, #64748b)"
                  : "linear-gradient(120deg, #2563eb, #1d4ed8)",
                color: "white",
                fontWeight: 700,
                fontSize: "15px",
                cursor: submitted ? "not-allowed" : "pointer",
                boxShadow: "0 12px 24px rgba(37, 99, 235, 0.32)",
              }}
            >
              {submitted ? "Quiz submitted" : "Submit answers"}
            </button>
            {submitted && (
              <button
                type="button"
                onClick={handleRetake}
                style={{
                  padding: "14px 22px",
                  borderRadius: "12px",
                  border: "1px solid rgba(15, 23, 42, 0.15)",
                  backgroundColor: "white",
                  color: "#0f172a",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Retake quiz
              </button>
            )}
          </div>

          {submitted && score !== null && (
            <div
              style={{
                marginTop: "12px",
                backgroundColor: "white",
                borderRadius: "12px",
                padding: "18px",
                border: "1px solid rgba(22, 163, 74, 0.25)",
                color: "#15803d",
                fontWeight: 600,
              }}
            >
              You got {score}% correct. Keep practising and retake the quiz anytime to improve your score!
            </div>
          )}
        </form>
      </div>
    </main>
  );
}
