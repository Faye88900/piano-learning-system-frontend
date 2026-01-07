"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";

export function useSessionUser() {
  const [sessionUser, setSessionUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setSessionUser(null);
        setLoading(false);
        return;
      }

      try {
        const profileRef = doc(db, "users", user.uid);
        const profileSnap = await getDoc(profileRef);
        const profileData = profileSnap.exists() ? profileSnap.data() : {};

        setSessionUser({
          uid: user.uid,
          email: user.email ?? profileData.email ?? "",
          role: profileData.role ?? "student",
          profileName:
            profileData.profileName ??
            profileData.displayName ??
            user.displayName ??
            user.email ??
            "",
        });
      } catch (error) {
        console.error("Failed to load user profile", error);
        setSessionUser({
          uid: user.uid,
          email: user.email ?? "",
          role: "student",
        });
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  return { sessionUser, loading };
}
