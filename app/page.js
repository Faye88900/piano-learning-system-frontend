"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {fetchSignInMethodsForEmail,GoogleAuthProvider,sendPasswordResetEmail,signInWithEmailAndPassword,signInWithPopup,} from "firebase/auth";
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";

const LOGIN_ERROR_MESSAGES = {
  "auth/invalid-email": "Gmail format is invalid. Please check your Gmail.",
  "auth/user-not-found": "This Gmail is not registered. Please check your Gmail or register first.",
  "auth/wrong-password": "Password is incorrect. Please try again.",
  "auth/user-disabled": "This account has been disabled. Please contact support.",
  "auth/too-many-requests": "Too many failed attempts. Please try again later.",
  "auth/network-request-failed": "Network error. Please check your connection and try again.",
};

const FALLBACK = "Login failed. Please check your Gmail and password.";

async function getFriendlyLoginErrorMessage(error, email) {
  if (!(error instanceof Error)) return FALLBACK;

  const errorCode = typeof error.code === "string" ? error.code : "";

  if (errorCode in LOGIN_ERROR_MESSAGES) {
    return LOGIN_ERROR_MESSAGES[errorCode];
  }

  if (errorCode === "auth/invalid-credential") {
    return await resolveInvalidCredentialMessage(email);
  }

  return FALLBACK;
}

async function resolveInvalidCredentialMessage(email) {
  try {
    const userSnap = await getDocs(
      query(collection(db, "users"), where("email", "==", email), limit(1))
    );
    return userSnap.empty
      ? "This Gmail is not registered. Please check your Gmail or register first."
      : "Password is incorrect. Please try again.";
  } catch (err) {
    console.error("Failed to check login profile", err);
    return "Gmail or password is incorrect. Please try again.";
  }
}

function getFriendlyResetErrorMessage(error) {
  const errorCode = typeof error?.code === "string" ? error.code : "";
  if (errorCode === "auth/invalid-email") {
    return "Gmail format is invalid. Please check your Gmail.";
  }
  if (errorCode === "auth/user-not-found") {
    return "This Gmail is not registered. Please check your Gmail or register first.";
  }
  if (errorCode === "auth/too-many-requests") {
    return "Too many attempts. Please try again later.";
  }
  if (errorCode === "auth/network-request-failed") {
    return "Network error. Please check your connection and try again.";
  }
  if (errorCode === "auth/operation-not-allowed") {
    return "Password reset is not enabled in Firebase Authentication settings.";
  }
  return "Unable to send reset email. Please try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [isResetSubmitting, setIsResetSubmitting] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [hasResetBeenSent, setHasResetBeenSent] = useState(false);
  const [notice, setNotice] = useState(null);
  const clearNoticeTimerRef = useRef(null);
  const { sessionUser, loading } = useSessionUser();
  const googleProvider = new GoogleAuthProvider();

  useEffect(() => {

    if (loading) return;
    if (!sessionUser) return;
    const nextRoute =
    sessionUser.role === "teacher" ? "/teacher/dashboard" : "/Dashboard";
    router.push(nextRoute);
  //用来处理已经登入过的用户 自动跳转页面
  }, [sessionUser, loading, router]);

  useEffect(() => {
    return () => {
      if (clearNoticeTimerRef.current) {
        clearTimeout(clearNoticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = setTimeout(() => {
      setResetCooldown((current) => current - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [resetCooldown]);

  function openNotice(type, title, message) {
    setNotice({ type, title, message });
    if (clearNoticeTimerRef.current) {
      clearTimeout(clearNoticeTimerRef.current);
    }
    clearNoticeTimerRef.current = setTimeout(() => {
      setNotice(null);
    }, 4200);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      openNotice("warning", "Missing details", "Please enter both email and password.");
      return;
    }

    try {
      setIsSubmitting(true);
      const credential = await signInWithEmailAndPassword(
        //认证密码和gmail 登入相对的页面
        auth,
        trimmedEmail,
        password
      );

      const profileSnap = await getDoc(doc(db, "users", credential.user.uid));
      if (!profileSnap.exists()) {
        openNotice("error", "Profile not found", "Please contact support.");
        return;
      }

      const profile = profileSnap.data();
      const nextRoute = profile.role === "teacher" ? "/teacher/dashboard" : "/Dashboard";
      router.push(nextRoute);
    } catch (error) {
      console.error("Failed to sign in", error);
      const friendlyMessage = await getFriendlyLoginErrorMessage(error, trimmedEmail);
      openNotice(
        "error",
        "Login failed",
        friendlyMessage
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    try {
      setIsSubmitting(true);
      const credential = await signInWithPopup(auth, googleProvider);
      const profileRef = doc(db, "users", credential.user.uid);
      const profileSnap = await getDoc(profileRef);

      if (!profileSnap.exists()) {
        await setDoc(profileRef, {
          email: credential.user.email ?? "",
          role: "student",
          createdAt: serverTimestamp(),
        });
      }

      const nextRole = profileSnap.exists()
        ? profileSnap.data().role ?? "student"
        : "student";
      const nextRoute = nextRole === "teacher" ? "/teacher/dashboard" : "/Dashboard";
      router.push(nextRoute);
    } catch (error) {
      console.error("Failed to sign in with Google", error);
      openNotice(
        "error",
        "Google sign-in failed",
        error instanceof Error ? error.message : "Google sign-in failed. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasswordReset() {
    const trimmedResetEmail = resetEmail.trim().toLowerCase();
    if (!trimmedResetEmail) {
      openNotice("warning", "Missing Gmail", "Please enter your Gmail to reset password.");
      return;
    }
    if (resetCooldown > 0) {
      openNotice("warning", "Please wait", `You can resend after ${resetCooldown}s.`);
      return;
    }

    try {
      setIsResetSubmitting(true);
      const signInMethods = await fetchSignInMethodsForEmail(auth, trimmedResetEmail);
      if (signInMethods.length > 0 && !signInMethods.includes("password")) {
        openNotice(
          "warning",
          "Use Google sign-in",
          "This Gmail is linked to Google sign-in. Please click Continue with Google."
        );
        return;
      }

      await sendPasswordResetEmail(auth, trimmedResetEmail);
      openNotice(
        "success",
        "Reset request submitted",
        "If this Gmail uses password login, the reset email should arrive within 1-2 minutes. Check Spam/Promotions for sender noreply@piano-learning-system-5fd93.firebaseapp.com."
      );
      setHasResetBeenSent(true);
      setResetCooldown(60);
      setIsResetOpen(false);
    } catch (error) {
      console.error("Failed to send password reset email", error);
      openNotice("error", "Reset failed", getFriendlyResetErrorMessage(error));
    } finally {
      setIsResetSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0f172a 0%, #312e81 45%, #1e3a8a 100%)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        color: "#0f172a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 20px",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "1080px",
          backgroundColor: "rgba(248, 250, 252, 0.96)",
          borderRadius: "28px",
          boxShadow: "0 30px 60px rgba(15, 23, 42, 0.35)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
          }}
        >
          <article
            style={{
              flex: "1 1 340px",
              padding: "48px 52px",
              background:
                "radial-gradient(circle at top left, rgba(59,130,246,0.18), transparent 55%), #f8fafc",
              borderRight: "1px solid rgba(15, 23, 42, 0.05)",
            }}
          >
            <header>
              <span
                style={{
                  display: "inline-block",
                  padding: "6px 14px",
                  borderRadius: "999px",
                  backgroundColor: "rgba(59, 130, 246, 0.15)",
                  color: "#1d4ed8",
                  fontWeight: 600,
                  fontSize: "12px",
                  letterSpacing: "0.14em",
                }}
              >
                PIANO LEARNING SUITE
              </span>
              <h1
                style={{
                  marginTop: "20px",
                  fontSize: "32px",
                  lineHeight: 1.2,
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                Craft your personalised piano journey
              </h1>
              <p
                style={{
                  marginTop: "14px",
                  fontSize: "15px",
                  lineHeight: 1.6,
                  color: "#475569",
                }}
              >
                Centralise repertoire planning, practice analytics, and performance feedback in one modern dashboard designed for students, teachers, and studio admins.
              </p>
            </header>

            <ul
              style={{
                marginTop: "26px",
                listStyle: "none",
                padding: 0,
                display: "grid",
                gap: "14px",
              }}
            >
              {[
                {
                  title: "Smart practice tracking",
                  body: "Upload sessions, receive rhythm & pitch insights instantly.",
                },
                {
                  title: "Collaborative studio tools",
                  body: "Share lesson notes, assign repertoire, and monitor progress together.",
                },
                {
                  title: "Performance milestones",
                  body: "Celebrate exam results and recital highlights with visual timelines.",
                },
              ].map((item) => (
                <li
                  key={item.title}
                  style={{
                    display: "flex",
                    gap: "12px",
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "24px",
                      height: "24px",
                      borderRadius: "999px",
                      backgroundColor: "#1d4ed8",
                      color: "white",
                      fontSize: "14px",
                      fontWeight: 700,
                    }}
                  >
                    ?
                  </span>
                  <div>
                    <h2
                      style={{
                        fontSize: "15px",
                        fontWeight: 600,
                        color: "#0f172a",
                        margin: 0,
                      }}
                    >
                      {item.title}
                    </h2>
                    <p style={{ margin: "6px 0 0", color: "#475569", fontSize: "13px" }}>
                      {item.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <footer
              style={{
                marginTop: "32px",
                display: "flex",
                flexWrap: "wrap",
                gap: "16px",
                fontSize: "12px",
                color: "#475569",
              }}
            >
              <div>
                <strong style={{ color: "#0f172a", fontSize: "16px" }}>1.2K+</strong> active learners
              </div>
              <div>
                <strong style={{ color: "#0f172a", fontSize: "16px" }}>98%</strong> lesson attendance rate
              </div>
              <div>
                <strong style={{ color: "#0f172a", fontSize: "16px" }}>15</strong> curated repertoires weekly
              </div>
            </footer>
          </article>

          <form
            onSubmit={handleSubmit}
            style={{
              flex: "1 1 320px",
              padding: "52px 56px",
              backgroundColor: "white",
              display: "grid",
              gap: "24px",
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: "26px",
                  fontWeight: 700,
                  color: "#0f172a",
                  marginBottom: "6px",
                }}
              >
                Welcome back
              </h2>
              <p style={{ color: "#64748b", fontSize: "14px", margin: 0 }}>
                Sign in to continue your practice journey.
              </p>
            </div>

            <div style={{ display: "grid", gap: "18px" }}>
              <label style={{ display: "grid", gap: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>Email</span>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  style={{
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5f5",
                    backgroundColor: "#f8fafc",
                    fontSize: "14px",
                    color: "#0f172a",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>Password</span>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  style={{
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5f5",
                    backgroundColor: "#f8fafc",
                    fontSize: "14px",
                    color: "#0f172a",
                  }}
                />
              </label>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: "12px",
                  color: "#475569",
                }}
              >
                <span>Need help? Contact your studio admin.</span>
                <button
                  type="button"
                  onClick={() => {
                    const nextOpen = !isResetOpen;
                    setIsResetOpen(nextOpen);
                    if (nextOpen) {
                      setResetEmail(email.trim());
                    }
                  }}
                  style={{
                    color: "#1d4ed8",
                    fontWeight: 600,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Forgot password?
                </button>
              </div>

              {isResetOpen && (
                <div
                  style={{
                    borderRadius: "12px",
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                    padding: "12px",
                    display: "grid",
                    gap: "10px",
                  }}
                >
                  <p style={{ margin: 0, color: "#334155", fontSize: "12px" }}>
                    Enter your Gmail and we&apos;ll send a reset link.
                  </p>
                  <p style={{ margin: 0, color: "#64748b", fontSize: "12px" }}>
                    If this account uses Google sign-in, use Continue with Google instead.
                  </p>
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(event) => {
                      setResetEmail(event.target.value);
                      setHasResetBeenSent(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handlePasswordReset();
                      }
                    }}
                    placeholder="you@example.com"
                    style={{
                      padding: "10px 12px",
                      borderRadius: "10px",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "white",
                      fontSize: "13px",
                      color: "#0f172a",
                    }}
                  />
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={handlePasswordReset}
                      disabled={isResetSubmitting || resetCooldown > 0}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "none",
                        background: "#1d4ed8",
                        color: "white",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                        opacity: isResetSubmitting ? 0.7 : 1,
                      }}
                    >
                      {isResetSubmitting
                        ? "Sending..."
                        : resetCooldown > 0
                          ? `Resend in ${resetCooldown}s`
                          : hasResetBeenSent
                            ? "Resend link"
                            : "Send reset link"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsResetOpen(false)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid #cbd5e1",
                        background: "white",
                        color: "#334155",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: "14px 18px",
                borderRadius: "12px",
                border: "none",
                background: "linear-gradient(120deg, #2563eb, #1d4ed8)",
                color: "white",
                fontWeight: 700,
                fontSize: "15px",
                cursor: "pointer",
                boxShadow: "0 12px 24px rgba(37, 99, 235, 0.35)",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? "Processing..." : "Sign in to dashboard"}
            </button>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSubmitting}
              style={{
                padding: "14px 18px",
                borderRadius: "12px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#0f172a",
                fontWeight: 700,
                fontSize: "15px",
                cursor: "pointer",
                boxShadow: "0 10px 20px rgba(15, 23, 42, 0.08)",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              Continue with Google
            </button>

            <p style={{ fontSize: "13px", color: "#475569", margin: 0 }}>
              Don&apos;t have an account yet?
              <Link
                href="/register"
                style={{
                  marginLeft: "8px",
                  color: "#1d4ed8",
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                Create one now
              </Link>
            </p>
          </form>
        </div>
      </section>

      {notice && (
        <aside
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            right: "20px",
            top: "20px",
            maxWidth: "360px",
            width: "calc(100% - 40px)",
            borderRadius: "16px",
            backgroundColor: "rgba(15, 23, 42, 0.96)",
            color: "#e2e8f0",
            boxShadow: "0 24px 48px rgba(2, 6, 23, 0.45)",
            border: `1px solid ${
              notice.type === "success"
                ? "rgba(34, 197, 94, 0.45)"
                : notice.type === "warning"
                  ? "rgba(251, 191, 36, 0.45)"
                  : "rgba(239, 68, 68, 0.45)"
            }`,
            padding: "16px 18px",
            zIndex: 30,
            display: "grid",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <strong
              style={{
                fontSize: "14px",
                color:
                  notice.type === "success"
                    ? "#86efac"
                    : notice.type === "warning"
                      ? "#fcd34d"
                      : "#fca5a5",
              }}
            >
              {notice.title}
            </strong>
            <button
              type="button"
              onClick={() => setNotice(null)}
              style={{
                border: "none",
                background: "transparent",
                color: "#cbd5e1",
                fontSize: "13px",
                cursor: "pointer",
                padding: "0",
              }}
            >
              Close
            </button>
          </div>
          <p style={{ margin: 0, lineHeight: 1.5, fontSize: "13px" }}>{notice.message}</p>
        </aside>
      )}
    </main>
  );
}
