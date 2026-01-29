'use client';

import { useEffect, useState } from 'react';

interface Message {
    id: string;
    group_name: string;
    group_type: string;
    message: string;
    created_at: string;
    is_replied: boolean;
    is_important: boolean;
    note: string | null;
}

export default function MessagesPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [groups, setGroups] = useState<string[]>([]);

    // 篩選狀態
    const [dateFilter, setDateFilter] = useState('all');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    const [groupFilter, setGroupFilter] = useState('all');
    const [searchText, setSearchText] = useState('');
    const [importantOnly, setImportantOnly] = useState(false);

    // 編輯備註
    const [editingNote, setEditingNote] = useState<string | null>(null);
    const [noteText, setNoteText] = useState('');

    const loadMessages = () => {
        setLoading(true);
        const params = new URLSearchParams();

        // 時間篩選
        if (dateFilter === 'today') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            params.set('start_date', today.toISOString());
        } else if (dateFilter === '7days') {
            const date = new Date();
            date.setDate(date.getDate() - 7);
            params.set('start_date', date.toISOString());
        } else if (dateFilter === '30days') {
            const date = new Date();
            date.setDate(date.getDate() - 30);
            params.set('start_date', date.toISOString());
        } else if (dateFilter === 'custom') {
            if (customStartDate) {
                params.set('start_date', new Date(customStartDate).toISOString());
            }
            if (customEndDate) {
                const endDate = new Date(customEndDate);
                endDate.setHours(23, 59, 59, 999);
                params.set('end_date', endDate.toISOString());
            }
        }

        if (groupFilter !== 'all') {
            params.set('group_name', groupFilter);
        }

        if (searchText) {
            params.set('search', searchText);
        }

        if (importantOnly) {
            params.set('important', 'true');
        }

        fetch(`/api/dashboard/messages?${params.toString()}`)
            .then((res) => res.json())
            .then((data) => {
                setMessages(data.messages || []);
                setGroups(data.groups || []);
                setLoading(false);
            });
    };

    useEffect(() => {
        loadMessages();
    }, [dateFilter, customStartDate, customEndDate, groupFilter, importantOnly]);

    // 搜尋防抖
    useEffect(() => {
        const timer = setTimeout(() => {
            loadMessages();
        }, 300);
        return () => clearTimeout(timer);
    }, [searchText]);

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString('zh-TW', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const toggleImportant = async (id: string, currentValue: boolean) => {
        await fetch('/api/dashboard/messages', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, is_important: !currentValue }),
        });
        setMessages(messages.map(m =>
            m.id === id ? { ...m, is_important: !currentValue } : m
        ));
    };

    const saveNote = async (id: string) => {
        await fetch('/api/dashboard/messages', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, note: noteText }),
        });
        setMessages(messages.map(m =>
            m.id === id ? { ...m, note: noteText } : m
        ));
        setEditingNote(null);
        setNoteText('');
    };

    const startEditNote = (msg: Message) => {
        setEditingNote(msg.id);
        setNoteText(msg.note || '');
    };

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-gray-800">客戶訊息</h1>

            {/* 篩選區 */}
            <div className="bg-white rounded-xl shadow-sm border p-4 space-y-4">
                {/* 第一行：搜尋 */}
                <div className="flex gap-2">
                    <div className="flex-1 relative">
                        <input
                            type="text"
                            placeholder="🔍 搜尋訊息內容..."
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            className="w-full border border-gray-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-200"
                        />
                    </div>
                    <button
                        onClick={() => setImportantOnly(!importantOnly)}
                        className={`px-4 py-2 rounded-lg border transition ${importantOnly
                                ? 'bg-yellow-100 border-yellow-300 text-yellow-700'
                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        ⭐ 重要
                    </button>
                </div>

                {/* 第二行：時間與群組篩選 */}
                <div className="flex flex-wrap gap-2">
                    <select
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                    >
                        <option value="all">全部時間</option>
                        <option value="today">今天</option>
                        <option value="7days">最近 7 天</option>
                        <option value="30days">最近 30 天</option>
                        <option value="custom">自訂時間</option>
                    </select>

                    {dateFilter === 'custom' && (
                        <>
                            <input
                                type="date"
                                value={customStartDate}
                                onChange={(e) => setCustomStartDate(e.target.value)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                            />
                            <span className="py-2 text-gray-400">到</span>
                            <input
                                type="date"
                                value={customEndDate}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                            />
                        </>
                    )}

                    <select
                        value={groupFilter}
                        onChange={(e) => setGroupFilter(e.target.value)}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                    >
                        <option value="all">全部群組</option>
                        {groups.map((g) => (
                            <option key={g} value={g}>{g}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* 訊息列表 */}
            {loading ? (
                <div className="text-center py-10 text-gray-500">載入中...</div>
            ) : messages.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border p-6 text-center text-gray-500">
                    沒有找到訊息
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <div className="divide-y divide-gray-100">
                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`p-4 hover:bg-gray-50 ${msg.is_important ? 'bg-yellow-50' : ''}`}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className="px-2 py-1 rounded-full text-xs font-medium"
                                            style={{ backgroundColor: '#aa162c20', color: '#aa162c' }}
                                        >
                                            {msg.group_name}
                                        </span>
                                        <button
                                            onClick={() => toggleImportant(msg.id, msg.is_important)}
                                            className={`text-lg ${msg.is_important ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'}`}
                                        >
                                            ⭐
                                        </button>
                                    </div>
                                    <span className="text-xs text-gray-400">
                                        {formatDate(msg.created_at)}
                                    </span>
                                </div>

                                <p className="text-gray-800 mb-2">{msg.message}</p>

                                {/* 備註區 */}
                                {editingNote === msg.id ? (
                                    <div className="mt-2 flex gap-2">
                                        <input
                                            type="text"
                                            value={noteText}
                                            onChange={(e) => setNoteText(e.target.value)}
                                            placeholder="輸入備註..."
                                            className="flex-1 border border-gray-200 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                                            autoFocus
                                        />
                                        <button
                                            onClick={() => saveNote(msg.id)}
                                            className="px-3 py-1 text-sm text-white rounded-lg"
                                            style={{ backgroundColor: '#aa162c' }}
                                        >
                                            儲存
                                        </button>
                                        <button
                                            onClick={() => setEditingNote(null)}
                                            className="px-3 py-1 text-sm text-gray-500 bg-gray-100 rounded-lg"
                                        >
                                            取消
                                        </button>
                                    </div>
                                ) : (
                                    <div className="mt-2 flex items-center gap-2">
                                        {msg.note ? (
                                            <span
                                                className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded cursor-pointer hover:bg-gray-200"
                                                onClick={() => startEditNote(msg)}
                                            >
                                                📝 {msg.note}
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => startEditNote(msg)}
                                                className="text-sm text-gray-400 hover:text-gray-600"
                                            >
                                                + 加備註
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="text-center text-sm text-gray-400">
                共 {messages.length} 則訊息
            </div>
        </div>
    );
}