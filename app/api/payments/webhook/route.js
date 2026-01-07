import Stripe from "stripe";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export const runtime = "nodejs";

export async function POST(req) {
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed", error?.message || error);
    return NextResponse.json({ error: `Webhook Error: ${error.message}` }, { status: 400 });
  }
//payment successful
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const { enrollmentId, courseId } = session.metadata || {};
      if (enrollmentId) {
        await adminDb.collection("enrollments").doc(enrollmentId).set(
          {
            status: "Paid",
            paymentStatus: "paid",
            paymentIntentId: session.payment_intent || "",
            paymentProvider: "stripe",
            paidAt: new Date().toISOString(),
            courseId: courseId || "",
          },
          { merge: true }
        );
      }
    }
  } catch (error) {
    console.error("Failed to handle Stripe webhook event", error);
    return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}