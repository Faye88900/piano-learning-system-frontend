"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useSessionUser } from "@/hooks/useSessionUser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { sessionUser, loading } = useSessionUser();

  useEffect(() => {

    if (loading) return;
    if (!sessionUser) return;
    const nextRoute =
    sessionUser.role === "teacher" ? "/teacher/dashboard" : "/Dashboard";
    router.push(nextRoute);
  //用来处理已经登入过的用户 自动跳转页面
  }, [sessionUser, loading, router]);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      alert("Please enter email and password");
      return;
    }

    try {
      const credential = await signInWithEmailAndPassword(
        //认证密码和gmail 登入相对的页面
        auth,
        trimmedEmail,
        password
      );

      const profileSnap = await getDoc(doc(db, "users", credential.user.uid));
      if (!profileSnap.exists()) {
        alert("Profile not found. Please contact support.");
        return;
      }

      const profile = profileSnap.data();
      const nextRoute = profile.role === "teacher" ? "/teacher/dashboard" : "/Dashboard";
      router.push(nextRoute);
    } catch (error) {
      console.error("Failed to sign in", error);
      alert(error instanceof Error ? error.message : "Incorrect email or password");
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
                <Link href="#" style={{ color: "#1d4ed8", textDecoration: "none", fontWeight: 600 }}>
                  Forgot password?
                </Link>
              </div>
            </div>

            <button
              type="submit"
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
              }}
            >
              Sign in to dashboard
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
    </main>
  );
}