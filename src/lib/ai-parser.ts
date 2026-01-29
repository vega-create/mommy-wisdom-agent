import { openai } from './openai';
import { supabase } from './supabase';

interface ParseResult {
    intent: 'add_task' | 'complete_task' | 'query_tasks' | 'query_progress' | 'unknown';
    employee_name?: string;
    task_name?: string;
    client_name?: string;
    frequency?: string;
    frequency_detail?: string;
    message?: string;
}

export async function parseMessage(text: string, groupType: string): Promise<ParseResult> {
    const prompt = `你是一個任務管理助理。分析以下訊息，判斷意圖並提取資訊。

訊息：「${text}」
群組類型：${groupType}

請回傳 JSON 格式：
{
  "intent": "add_task" | "complete_task" | "query_tasks" | "query_progress" | "unknown",
  "employee_name": "員工名稱（如有）",
  "task_name": "任務名稱（如有）",
  "client_name": "客戶名稱（如有）",
  "frequency": "daily | weekly | monthly | custom（如有）",
  "frequency_detail": "週二,週三 或 每月15號（如有）"
}

判斷規則：
- 「新增XX任務」「幫XX加一個工作」→ intent: add_task
- 「完成了」「做好了」「弄好了」「OK了」「已排程」「已完成」→ intent: complete_task
- 「XX的任務」「今天要做什麼」→ intent: query_tasks
- 「成效」「進度」「報表」→ intent: query_progress
- 一般聊天、不相關 → intent: unknown

範例：
- 「新增雅涵任務，每週三做寵樂芙廣告」→ intent: add_task
- 「寵樂芙廣告完成了」→ intent: complete_task
- 「媽咪小編輪播好了～」→ intent: complete_task
- 「佳音圖第一週完成 已排程」→ intent: complete_task
- 「雅涵今天的任務」→ intent: query_tasks
- 「這個月的成效」→ intent: query_progress
- 「早安」「好的」「謝謝」→ intent: unknown

只回傳 JSON，不要其他文字。`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
        });

        const content = response.choices[0]?.message?.content || '{}';
        const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        console.error('AI parse error:', error);
        return { intent: 'unknown' };
    }
}

// 新增任務
export async function addTask(
    employeeName: string,
    taskName: string,
    clientName: string,
    frequency: string,
    frequencyDetail: string
) {
    const { data: employee } = await supabase
        .from('agent_employees')
        .select('id')
        .eq('name', employeeName)
        .single();

    if (!employee) {
        return { success: false, message: `找不到員工「${employeeName}」` };
    }

    const { error } = await supabase.from('agent_tasks').insert({
        task_name: taskName,
        client_name: clientName,
        employee_id: employee.id,
        frequency: frequency || 'weekly',
        frequency_detail: frequencyDetail,
        is_active: true,
    });

    if (error) {
        return { success: false, message: '新增失敗' };
    }

    return {
        success: true,
        message: `✅ 已新增任務！\n👤 ${employeeName}\n📋 ${clientName} - ${taskName}\n🔄 ${frequencyDetail || frequency}`
    };
}

// 完成任務（智慧比對）
export async function completeTask(
    employeeId: string,
    messageText: string
) {
    const { data: tasks } = await supabase
        .from('agent_tasks')
        .select('id, task_name, client_name')
        .eq('employee_id', employeeId)
        .eq('is_active', true);

    if (!tasks || tasks.length === 0) {
        return { success: false, message: '你目前沒有任務' };
    }

    const taskList = tasks.map((t, i) =>
        `${i + 1}. ${t.client_name} - ${t.task_name}`
    ).join('\n');

    const prompt = `員工說：「${messageText}」

他的任務列表：
${taskList}

請判斷這句話最可能是完成了哪個任務？
只回覆數字（例如：1），如果都不像就回覆 0`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
        });

        const answer = response.choices[0]?.message?.content?.trim() || '0';
        const taskIndex = parseInt(answer) - 1;

        if (taskIndex < 0 || taskIndex >= tasks.length) {
            return { success: false, message: '找不到對應的任務，可以說清楚一點嗎？' };
        }

        const task = tasks[taskIndex];

        await supabase.from('agent_task_records').insert({
            task_id: task.id,
            employee_id: employeeId,
            completed_at: new Date().toISOString(),
        });

        const today = new Date().toISOString().split('T')[0];
        const { count: completedCount } = await supabase
            .from('agent_task_records')
            .select('*', { count: 'exact', head: true })
            .eq('employee_id', employeeId)
            .gte('completed_at', today);

        const remaining = tasks.length - (completedCount || 0);

        return {
            success: true,
            message: `✅ 收到！已記錄「${task.client_name} - ${task.task_name}」完成\n📊 今日還剩 ${remaining} 項任務`
        };
    } catch (error) {
        console.error('AI 比對錯誤:', error);
        return { success: false, message: '系統錯誤，請稍後再試' };
    }
}

// 查詢員工任務
export async function getEmployeeTasks(employeeId: string) {
    const { data: tasks } = await supabase
        .from('agent_tasks')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('is_active', true);

    if (!tasks || tasks.length === 0) {
        return '目前沒有任務';
    }

    let message = '📋 任務清單：\n';
    tasks.forEach((task, i) => {
        message += `${i + 1}. ${task.client_name} - ${task.task_name} (${task.frequency_detail || task.frequency})\n`;
    });

    return message;
}

// 解析客戶訊息
export async function parseCustomerMessage(text: string): Promise<{
    type: 'urgent' | 'question' | 'payment' | 'general';
    reply: string;
}> {
    const prompt = `你是客服助理。分析客戶訊息，判斷類型並給出適當回覆。

客戶訊息：「${text}」

類型判斷：
- urgent：緊急、投訴、抱怨、不滿、退款、很急、馬上要、今天要
- question：問題、疑問、怪怪的、怎麼做、為什麼、這樣對嗎
- payment：轉帳、匯款、付款、已付、已匯、給你錢
- general：一般訊息、打招呼、謝謝、好的

回覆風格：簡短、親切、專業、加上表情符號

請回傳 JSON：
{
  "type": "urgent | question | payment | general",
  "reply": "回覆內容（20字內）"
}

範例：
- 「這邊怪怪的」→ {"type": "question", "reply": "稍等，我們確認後回覆您～ 🔍"}
- 「這個怎麼做？」→ {"type": "question", "reply": "收到！確認後回覆您 😊"}
- 「已轉帳」→ {"type": "payment", "reply": "收到，我們確認一下！💰"}
- 「匯款了喔」→ {"type": "payment", "reply": "好的，確認後通知您 ✨"}
- 「很急！拜託快點」→ {"type": "urgent", "reply": "收到！我們儘速處理 🙏"}
- 「為什麼還沒好」→ {"type": "urgent", "reply": "抱歉久等了，馬上確認！🏃"}
- 「謝謝」→ {"type": "general", "reply": "不客氣～有需要隨時說 😊"}
- 「你好」→ {"type": "general", "reply": "您好！有什麼可以幫您的嗎？✨"}
- 「好的」→ {"type": "general", "reply": "收到了，會儘速回覆您！👍"}

只回傳 JSON，不要其他文字。`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
        });

        const content = response.choices[0]?.message?.content || '{}';
        const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        console.error('Customer parse error:', error);
        return { type: 'general', reply: '收到了，會儘速回覆您！👍' };
    }
}