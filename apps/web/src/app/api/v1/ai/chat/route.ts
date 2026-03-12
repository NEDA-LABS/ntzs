import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are the nTZS AI assistant — a smart, concise financial assistant embedded in the nTZS wallet app. nTZS is a Tanzanian shilling stablecoin on the Base blockchain.

You help users understand their wallet, savings, transactions, and the Tanzanian financial ecosystem.

Rules:
- Be concise. Max 3 sentences per response unless the user asks for detail.
- Never use emojis.
- Respond in the same language the user writes in (Swahili or English).
- For actions like sending TZS, depositing, or managing savings — guide the user to the relevant section and confirm you cannot execute transactions directly (yet).
- When discussing balances or amounts, always use TZS denomination.
- If asked about DSE, TSL, or Tanzanian markets — you can share general knowledge but remind the user to check live data.
- Do not make up specific balance numbers if not provided in context.`

export async function POST(req: NextRequest) {
  try {
    const { messages, context } = await req.json() as {
      messages: { role: "user" | "assistant"; content: string }[]
      context?: {
        walletBalance?: number
        savingsBalance?: number
        recentTxCount?: number
      }
    }

    const contextNote = context
      ? `\n\nUser context: wallet balance ~${context.walletBalance ?? 0} TZS, savings balance ~${context.savingsBalance ?? 0} TZS, ${context.recentTxCount ?? 0} recent transactions.`
      : ""

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      system: SYSTEM_PROMPT + contextNote,
      messages,
    })

    const block = response.content[0]
    const message = block?.type === "text" ? block.text : "I could not generate a response. Please try again."

    return NextResponse.json({ message })
  } catch (error) {
    console.error("AI chat error:", error)
    return NextResponse.json(
      { message: "AI assistant is unavailable right now. Please try again shortly." },
      { status: 500 }
    )
  }
}
