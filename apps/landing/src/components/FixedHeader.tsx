export default function FixedHeader() {
  return (
    <header className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-gray-200 z-50">
      <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded-full bg-emerald-500"></span>
          <span className="font-bold text-lg tracking-wider">Ripipi</span>
        </div>
        <a
          href="#demo"
          className="bg-emerald-500 text-white px-5 py-2.5 rounded-2xl hover:bg-emerald-600 transition-colors font-medium text-sm"
        >
          15分デモを予約
        </a>
      </div>
    </header>
  );
}