// Deployed on prod (unkirihxtruhdjeldfpm) v17 ONLY — the demo project (tkryueqzvgcigvxgjzsp) does not have this function, so there is nothing to compare against and no drift.
// Supabase Edge Function: send-task-reminders
// Runs daily at 8am via Supabase Cron
// Sends reminder emails to ORDANIS Experts for upcoming tasks

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FROM_EMAIL = "alerts@pcmfamilyoffice.com";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

Deno.serve(async (req) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all pending tasks with reminders not yet sent
    const { data: tasks, error } = await sb
      .from("tasks")
      .select(`
        *,
        families (
          id,
          name,
          advisor_name,
          advisor_email
        )
      `)
      .eq("done", false)
      .eq("reminder_sent", false)
      .not("due_date", "is", null)
      .not("reminder_days", "is", null)
      .gt("reminder_days", 0);

    if (error) throw error;

    let sent = 0;
    let skipped = 0;
    const results = [];

    for (const task of tasks || []) {
      const family = task.families;
      if (!family?.advisor_email) { skipped++; continue; }

      const dueDate = new Date(task.due_date);
      dueDate.setHours(0, 0, 0, 0);

      // Calculate when reminder should be sent
      const reminderDate = new Date(dueDate);
      reminderDate.setDate(reminderDate.getDate() - task.reminder_days);
      reminderDate.setHours(0, 0, 0, 0);

      // Only send if today is the reminder date
      if (today.getTime() !== reminderDate.getTime()) { skipped++; continue; }

      const daysUntilDue = Math.round((dueDate - today) / 86400000);
      const isOverdue = daysUntilDue < 0;
      const dueDateStr = dueDate.toLocaleDateString("en-US", { 
        weekday: "long", year: "numeric", month: "long", day: "numeric" 
      });

      // Build email
      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f9f7f3; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { background: #092b49; padding: 28px 36px; }
    .header-title { color: #ceb684; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; margin-bottom: 4px; }
    .header-name { color: #ffffff; font-size: 22px; font-weight: 600; }
    .gold-line { height: 2px; background: linear-gradient(90deg, #ceb684, #dfc99a, transparent); }
    .body { padding: 32px 36px; }
    .alert-box { background: ${isOverdue ? '#fde8e8' : daysUntilDue <= 7 ? '#fef3e2' : '#e8f0f8'}; 
                 border-left: 4px solid ${isOverdue ? '#d43030' : daysUntilDue <= 7 ? '#d4900a' : '#293d5c'}; 
                 border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; }
    .alert-label { font-size: 11px; font-weight: 700; color: ${isOverdue ? '#8b1a1a' : daysUntilDue <= 7 ? '#8a5c00' : '#293d5c'}; 
                   text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
    .alert-title { font-size: 20px; color: #092b49; font-weight: 600; margin-bottom: 4px; }
    .alert-due { font-size: 13px; color: #5a6e84; }
    .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ede8de; font-size: 13px; }
    .detail-label { color: #8fa0b2; }
    .detail-value { color: #092b49; font-weight: 600; }
    .cta { display: inline-block; background: #092b49; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; margin-top: 24px; }
    .footer { background: #092b49; padding: 16px 36px; display: flex; justify-content: space-between; align-items: center; }
    .footer-left { font-size: 11px; color: rgba(255,255,255,0.4); }
    .footer-right { font-size: 10px; color: rgba(206,182,132,0.5); letter-spacing: 0.1em; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-title">PCM Family Office · Task Reminder</div>
      <div class="header-name">${family.name}</div>
    </div>
    <div class="gold-line"></div>
    <div class="body">
      <p style="font-size:14px;color:#5a6e84;margin-bottom:20px;">
        Hello ${family.advisor_name || "ORDANIS Expert"},<br><br>
        This is your ${task.reminder_days}-day reminder for an upcoming task assigned to the <strong>${family.name}</strong> family.
      </p>

      <div class="alert-box">
        <div class="alert-label">${isOverdue ? '⚠ Overdue' : `Due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}`}</div>
        <div class="alert-title">${task.title}</div>
        <div class="alert-due">${dueDateStr}</div>
      </div>

      <div class="detail-row">
        <span class="detail-label">Family</span>
        <span class="detail-value">${family.name}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Priority</span>
        <span class="detail-value">${task.priority}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Due Date</span>
        <span class="detail-value">${dueDateStr}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Status</span>
        <span class="detail-value">${isOverdue ? 'Overdue' : 'Pending'}</span>
      </div>

      <a href="https://pcm-realestate.vercel.app" class="cta">View in PCM Platform →</a>
    </div>
    <div class="footer">
      <div class="footer-left">PCM Family Office · alerts@pcmfamilyoffice.com</div>
      <div class="footer-right">CONFIDENTIAL</div>
    </div>
  </div>
</body>
</html>`;

      // Send via Resend
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `PCM Family Office <${FROM_EMAIL}>`,
          to: [family.advisor_email],
          subject: `⏰ Reminder: "${task.title}" — ${family.name} (Due ${daysUntilDue >= 0 ? `in ${daysUntilDue} days` : 'OVERDUE'})`,
          html: emailHtml,
        }),
      });

      if (res.ok) {
        // Mark reminder as sent
        await sb.from("tasks").update({ reminder_sent: true }).eq("id", task.id);
        sent++;
        results.push({ task: task.title, family: family.name, to: family.advisor_email, status: "sent" });
      } else {
        const err = await res.text();
        results.push({ task: task.title, family: family.name, to: family.advisor_email, status: "failed", error: err });
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      sent, 
      skipped, 
      total: (tasks || []).length,
      results 
    }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
