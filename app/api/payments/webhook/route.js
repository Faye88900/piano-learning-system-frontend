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
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || "";
        let receiptUrl = "";
        let amountReceived = null;
        let currency = "";

        if (paymentIntentId) {
          try {
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
              expand: ["latest_charge"],
            });
            amountReceived =
              typeof paymentIntent.amount_received === "number"
                ? paymentIntent.amount_received
                : paymentIntent.amount ?? null;
            currency = paymentIntent.currency || "";

            const latestCharge =
              typeof paymentIntent.latest_charge === "string"
                ? null
                : paymentIntent.latest_charge;
            receiptUrl = latestCharge?.receipt_url || "";

            if (!receiptUrl) {
              const chargeId =
                typeof paymentIntent.latest_charge === "string"
                  ? paymentIntent.latest_charge
                  : latestCharge?.id;
              if (chargeId) {
                const charge = await stripe.charges.retrieve(chargeId);
                receiptUrl = charge?.receipt_url || "";
              } else {
                const charges = await stripe.charges.list({
                  payment_intent: paymentIntentId,
                  limit: 1,
                });
                receiptUrl = charges.data?.[0]?.receipt_url || "";
              }
            }
          } catch (error) {
            console.error("Failed to retrieve payment intent/receipt", error);
          }
        }

        await adminDb.collection("enrollments").doc(enrollmentId).set(
          {
            status: "Paid",
            paymentStatus: "paid",
            paymentIntentId,
            paymentProvider: "stripe",
            paymentAmount: amountReceived,
            paymentCurrency: currency,
            paymentReceiptUrl: receiptUrl,
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
