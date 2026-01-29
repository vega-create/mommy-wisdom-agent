export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav style={{ backgroundColor: '#aa162c' }} className="shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <a href="/dashboard" className="text-xl font-bold text-white">
                智慧媽咪
              </a>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-6">
              <a href="/dashboard" className="px-3 py-2 text-base text-white/80 hover:text-white hover:bg-white/10 rounded">
                總覽
              </a>
              <a href="/dashboard/messages" className="px-3 py-2 text-base text-white/80 hover:text-white hover:bg-white/10 rounded">
                訊息
              </a>
              <a href="/dashboard/tasks" className="px-3 py-2 text-base text-white/80 hover:text-white hover:bg-white/10 rounded">
                任務
              </a>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}