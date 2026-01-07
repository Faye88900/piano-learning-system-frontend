"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

const roles = [
  { value: "student", label: "Student" },
  { value: "teacher", label: "Teacher" },
  { value: "admin", label: "Admin" },
];

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(roles[0].value);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      alert("Please enter email and password");
      return;
    }

    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        trimmedEmail,
        password
      );

      await setDoc(doc(db, "users", credential.user.uid), {
        email: trimmedEmail,
        role,
        createdAt: serverTimestamp(),
      });

      alert("Registration successful. Please login.");
      router.push("/");
    } catch (error) {
      console.error("Failed to register user", error);
      alert(error instanceof Error ? error.message : "Failed to register. Please try again.");
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0f172a 0%, #312e81 45%, #1e3a8a 100%)",
        fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 20px",
        color: "#0f172a",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "1120px",
          backgroundColor: "rgba(248, 250, 252, 0.96)",
          borderRadius: "28px",
          boxShadow: "0 30px 60px rgba(15, 23, 42, 0.35)",
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        }}
      >
        <article
          style={{
            padding: "52px 56px",
            borderRight: "1px solid rgba(15, 23, 42, 0.05)",
            background:
              "radial-gradient(circle at top left, rgba(59,130,246,0.2), transparent 55%), #f8fafc",
            display: "grid",
            gap: "26px",
          }}
        >
          <header style={{ display: "grid", gap: "16px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                color: "#1d4ed8",
                padding: "6px 16px",
                borderRadius: "999px",
                fontSize: "12px",
                fontWeight: 600,
                letterSpacing: "0.14em",
              }}
            >
              BUILD YOUR LEARNING PARTNERSHIP
            </span>
            <div>
              <h1
                style={{
                  fontSize: "32px",
                  lineHeight: 1.2,
                  fontWeight: 700,
                  color: "#0f172a",
                  margin: 0,
                }}
              >
                One platform connecting students and teachers
              </h1>
              <p style={{ marginTop: "14px", fontSize: "15px", color: "#475569", lineHeight: 1.6 }}>
                Students get structured guidance while teachers gain clear oversight. Plan repertoire, track lessons, and celebrate every milestone together.
              </p>
            </div>
          </header>

          <section style={{ display: "grid", gap: "18px" }}>
            {[
              {
                title: "Student experience",
                description: "Structured practice plans, progress visualisation, and instant lesson feedback.",
              },
              {
                title: "Teacher workspace",
                description: "Assign repertoire, review recorded submissions, and streamline lesson notes.",
              },
              {
                title: "Admin console",
                description: "Manage enrolments, payments, scheduling, and studio communications in one dashboard.",
              },
            ].map((card) => (
              <div
                key={card.title}
                style={{
                  backgroundColor: "white",
                  borderRadius: "18px",
                  padding: "20px 22px",
                  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.10)",
                }}
              >
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#0f172a", margin: 0 }}>
                  {card.title}
                </h2>
                <p style={{ marginTop: "8px", fontSize: "13px", color: "#475569", lineHeight: 1.5 }}>
                  {card.description}
                </p>
              </div>
            ))}
          </section>

          <footer
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "16px",
              marginTop: "12px",
              fontSize: "12px",
              color: "#475569",
            }}
          >
            <div>
              <strong style={{ color: "#0f172a", fontSize: "16px" }}>250+</strong> active studios
            </div>
            <div>
              <strong style={{ color: "#0f172a", fontSize: "16px" }}>4.9/5</strong> learner satisfaction
            </div>
            <div>
              <strong style={{ color: "#0f172a", fontSize: "16px" }}>24/7</strong> practice analytics
            </div>
          </footer>
        </article>

        <form
          onSubmit={handleSubmit}
          style={{
            padding: "56px 60px",
            backgroundColor: "white",
            display: "grid",
            gap: "24px",
          }}
        >
          <div>
            <h2 style={{ fontSize: "28px", fontWeight: 700, color: "#0f172a", marginBottom: "6px" }}>
              Create your account
            </h2>
            <p style={{ color: "#64748b", fontSize: "14px", margin: 0 }}>
              Join the community and start managing your piano journey today.
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
                placeholder="Set a strong password"
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
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#1e293b" }}>Select your role</span>
              <select
                id="role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                style={{
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid #cbd5f5",
                  backgroundColor: "#f8fafc",
                  fontSize: "14px",
                  color: "#0f172a",
                  appearance: "none",
                }}
              >
                {roles.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="submit"
            style={{
              padding: "14px 18px",
              borderRadius: "12px",
              border: "none",
              background: "linear-gradient(120deg, #16a34a, #15803d)",
              color: "white",
              fontWeight: 700,
              fontSize: "15px",
              cursor: "pointer",
              boxShadow: "0 12px 24px rgba(22, 163, 74, 0.28)",
              transition: "transform 0.2s ease",
            }}
          >
            Create account
          </button>

          <p style={{ fontSize: "13px", color: "#475569", margin: 0 }}>
            Already registered?
            <Link
              href="/"
              style={{
                marginLeft: "8px",
                color: "#1d4ed8",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Return to sign in
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
