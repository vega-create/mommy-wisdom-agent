'use client';

import { useEffect, useState } from 'react';

interface Message {
    id: string;
    group_name: string;
    group_type: string;
    message: string;
    ai_suggestion: string;
    is_replied: boolean;
    created_at: string;
}

export default function MessagesPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/dashboard/messages')
            .then((res) => res.json())
            .then((data) => {
                setMessages(data.messages || []);
                setLoading(false);
            });
    }, []);

    if (loading) {
        return <div className="text-center py-10">載入中...</div>;
    }

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-gray-800">客戶訊息</h1>

            {messages.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
                    目前沒有未回覆的訊息
                </div>
            ) : (
                <div className="space-y-4">
                    {messages.map((msg) => (
                        <div key={msg.id} className="bg-white rounded-lg shadow p-4">
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <span className="font-medium">{msg.group_name}</span>
                                    <span className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded">
                                        {msg.group_type}
                                    </span>
                                </div>
                                <span className="text-xs text-gray-400">
                                    {new Date(msg.created_at).toLocaleString('zh-TW')}
                                </span>
                            </div>
                            <p className="text-gray-800 mb-3">{msg.message}</p>
                            {msg.ai_suggestion && (
                                <div className="bg-blue-50 p-3 rounded mb-3">
                                    <p className="text-sm text-blue-800">
                                        <span className="font-medium">AI 建議：</span>
                                        {msg.ai_suggestion}
                                    </p>
                                </div>
                            )}
                            <div className="flex space-x-2">
                                <button className="bg-green-500 text-white px-4 py-2 rounded text-sm hover:bg-green-600">
                                    發送回覆
                                </button>
                                <button className="bg-gray-200 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-300">
                                    標記已處理
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}