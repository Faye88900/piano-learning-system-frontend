import Stripe from "stripe";
import { NextResponse } from "next/server";
import { getCourseById } from "@/lib/courseCatalog";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export const runtime = "nodejs";

function getBaseUrl() {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export async function POST(req) {
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { courseId, enrollmentId, studentEmail, studentName } = body || {};
  if (!courseId || !enrollmentId) {
    return NextResponse.json({ error: "courseId and enrollmentId are required" }, { status: 400 });
  }

  const course = getCourseById(courseId);
  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const unitAmount = Math.round(Number(course.tuition) * 100);
  if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
    return NextResponse.json({ error: "Invalid tuition amount" }, { status: 400 });
  }

  try {
    //Call Stripe payment 
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: studentEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: "myr",
            unit_amount: unitAmount,
            product_data: {
              name: `${course.title} — ${studentName || "Student"}`,
              metadata: { courseId },
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        enrollmentId,
        courseId,
      },
      success_url: `${getBaseUrl()}/Dashboard?payment=success`,
      cancel_url: `${getBaseUrl()}/Dashboard?payment=cancelled`,
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("Failed to create Stripe Checkout session", error);
    return NextResponse.json({ error: "Unable to start payment" }, { status: 500 });
  }
}
