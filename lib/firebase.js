// lib/firebase.js
import { initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth"; // ✅ 新增 Authentication

// ✅ 你的 Firebase 配置
const firebaseConfig = {
  apiKey: "AIzaSyABgmdI7fgcVPGp40CGC3Nw6bfYQRZsg1U",
  authDomain: "piano-learning-system-5fd93.firebaseapp.com",
  projectId: "piano-learning-system-5fd93",
  storageBucket: "piano-learning-system-5fd93.firebasestorage.app",
  appId: "1:814720970641:web:caded7d1a0f5389fafb430",
  measurementId: "G-5E6P1YHCJ4",
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);

// ✅ 模块初始化
export const storage = getStorage(app);  // 文件上传
export const db = getFirestore(app);     // Firestore 数据库
export const auth = getAuth(app);        // ✅ 新增 Authentication

export default app;