export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok", { status: 200 });
    if (url.pathname !== "/webhook") return new Response("not found", { status: 404 });

    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (secret !== "zeinab_secret_2026") return new Response("forbidden", { status: 403 });

    let update;
    try { update = await request.json(); } catch (e) { return new Response("ok", { status: 200 }); }
    const message = update.message;
    if (!message || !message.text) return new Response("ok", { status: 200 });
    
    const userId = String(message.from.id);
    if (userId !== "242885583") return new Response("ok", { status: 200 });

    ctx.waitUntil(handleMessage(message, env));
    return new Response("ok", { status: 200 });
  },
};

async function handleMessage(message, env) {
  const chatId = message.chat.id;
  const text = message.text;
  let action;

  let systemPrompt = "تو یک ربات برنامه‌ریزی هستی. من به تو یک پیام فارسی می‌دهم. تو باید فقط و فقط یک کد JSON برگردانی. هیچ حرف اضافه‌ای، هیچ توضیحی و هیچ متنی ننویس. فقط کد را بده.\n";
  systemPrompt += "قوانین کد:\n";
  systemPrompt += "برای اضافه کردن کار: {\"action\":\"add\",\"text\":\"متن کار\"}\n";
  systemPrompt += "برای دیدن لیست کارها: {\"action\":\"list\"}\n";
  systemPrompt += "برای تیک زدن یک کار: {\"action\":\"done\",\"target\":\"متن کار\"}\n";
  systemPrompt += "برای حذف همه کارها: {\"action\":\"del\",\"target\":\"all\"}\n";
  systemPrompt += "برای حذف یک کار: {\"action\":\"del\",\"target\":\"متن کار\"}\n";
  systemPrompt += "برای سلام و احوالپرسی: {\"action\":\"chat\",\"reply\":\"جواب تو\"}\n";
  systemPrompt += "مثال: اگر من گفتم 'نان بخر'، تو فقط بنویس: {\"action\":\"add\",\"text\":\"نان\"}";

  try {
    // تغییر مدل به نسخه ۷۰ میلیارد پارامتری (بسیار قوی‌تر در فارسی و JSON)
    const response = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ]
    });
    
    let raw = response.response;
    if (typeof raw === "object" && raw !== null) {
      action = raw;
    } else {
      raw = String(raw).trim();
      const match = raw.match(/\{[\s\S]*\}/);
      action = JSON.parse(match ? match[0] : raw);
    }
  } catch (e) {
    return sendMessage(env, chatId, "خطای دقیق: " + e.message);
  }

  let reply = "";
  
  if (action.action === "add" && action.text) {
    await env.DB.prepare("INSERT INTO tasks (text, done, created_at) VALUES (?, 0, ?)").bind(action.text, new Date().toISOString()).run();
    reply = "تسک «" + action.text + "» اضافه شد.";
  } 
  else if (action.action === "list") {
    const result = await env.DB.prepare("SELECT * FROM tasks WHERE done = 0 ORDER BY id").all();
    if (result.results.length === 0) {
      reply = "هیچ تسکی نداری.";
    } else {
      reply = "لیست کارها:";
      for (let i = 0; i < result.results.length; i++) {
        reply = reply + " \n " + result.results[i].id + ". " + result.results[i].text;
      }
    }
  }
  else if (action.action === "done" && action.target) {
    await env.DB.prepare("UPDATE tasks SET done = 1 WHERE (id = ? OR text LIKE ?) AND done = 0").bind(action.target, "%" + action.target + "%").run();
    reply = "تسک «" + action.target + "» انجام شد.";
  }
  else if (action.action === "undone" && action.target) {
    await env.DB.prepare("UPDATE tasks SET done = 0 WHERE (id = ? OR text LIKE ?) AND done = 1").bind(action.target, "%" + action.target + "%").run();
    reply = "تسک «" + action.target + "» برگشت.";
  }
  else if (action.action === "del") {
    if (action.target === "all") {
      await env.DB.prepare("DELETE FROM tasks").run();
      reply = "همه تسک‌ها حذف شدند.";
    } else if (action.target) {
      await env.DB.prepare("DELETE FROM tasks WHERE id = ? OR text LIKE ?").bind(action.target, "%" + action.target + "%").run();
      reply = "تسک «" + action.target + "» حذف شد.";
    }
  }
  else if (action.action === "chat" && action.reply) {
    reply = action.reply;
  }
  else {
    reply = "متوجه نشدم. واضح‌تر بگو.";
  }

  await sendMessage(env, chatId, reply);
}

async function sendMessage(env, chatId, text) {
  const BOT_TOKEN = "9130958058:AAFZOUI7jJuOEdPk4nuTz0BPYFXmU6H9XKY";
  const url = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage";
  
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text })
  });
}
