import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are the nTZS AI assistant — a concise financial assistant inside the nTZS wallet app. nTZS is a Tanzanian shilling stablecoin on the Base blockchain.

Rules:
- Answer in 2 sentences maximum. Never more. Be extremely concise.
- Never use emojis, markdown, bullet points, or headers. Plain text only.
- Respond in the same language the user writes in (Swahili or English).
- Use the search_web tool whenever the user asks about current prices, news, DSE market data, exchange rates, or any real-time information.
- For wallet actions like deposits or transfers, guide the user to the relevant section — you cannot execute transactions.
- Always use TZS denomination. Never fabricate numbers not given to you.`

const SEARCH_TOOL: Anthropic.Tool = {
  name: "search_web",
  description: "Search the web for current financial news, DSE stock prices, TZS exchange rates, or any real-time information needed to answer accurately.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "A focused search query",
      },
    },
    required: ["query"],
  },
}

async function tavilySearch(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return "Live search is not configured."
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 3,
        search_depth: "basic",
        include_answer: true,
      }),
    })
    const data = await res.json() as {
      answer?: string
      results?: { title: string; content: string }[]
    }
    if (data.answer) return data.answer
    return (data.results ?? [])
      .slice(0, 3)
      .map((r) => `${r.title}: ${r.content.slice(0, 250)}`)
      .join("\n")
  } catch {
    return "Search failed."
  }
}

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
      ? `\n\nUser context: wallet ~${context.walletBalance ?? 0} TZS, savings ~${context.savingsBalance ?? 0} TZS, ${context.recentTxCount ?? 0} recent transactions.`
      : ""

    const system = SYSTEM_PROMPT + contextNote

    // First call — Claude decides whether to search
    const first = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      system,
      tools: [SEARCH_TOOL],
      messages: messages as Anthropic.MessageParam[],
    })

    // No search needed — return directly
    if (first.stop_reason !== "tool_use") {
      const block = first.content[0]
      const message = block?.type === "text" ? block.text : "I could not generate a response. Please try again."
      return NextResponse.json({ message })
    }


    // Claude wants to search — run Tavily then summarize
    const toolBlock = first.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined
    const query = (toolBlock?.input as { query?: string })?.query ?? ""
    const searchResult = await tavilySearch(query)

    const second = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 150,
      system,
      tools: [SEARCH_TOOL],
      messages: [
        ...(messages as Anthropic.MessageParam[]),
        { role: "assistant", content: first.content },
        {
          role: "user",
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: toolBlock?.id ?? "",
              content: searchResult,
            },
          ],
        },
      ],
    })

    const block = second.content[0]
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
