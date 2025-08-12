export default function FinalCTA() {
  return (
    <section className="py-16 px-4 bg-blue-600 text-white">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-3xl font-bold mb-6">
          まずは15分のデモから
        </h2>
        <p className="text-xl mb-8">
          実際の画面を見ながら、導入効果をご説明します
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
          <a
            href="#demo"
            className="bg-white text-blue-600 px-8 py-4 rounded-2xl hover:bg-gray-100 transition-colors text-lg font-medium shadow-lg"
          >
            15分デモを予約
          </a>
          <button
            onClick={() => alert("デモQRを表示（実装予定）")}
            className="bg-transparent text-white border-2 border-white px-8 py-4 rounded-2xl hover:bg-white hover:text-blue-600 transition-colors text-lg font-medium"
          >
            デモQRで体験
          </button>
        </div>

        <div>
          <p className="mb-2">スマホでスキャン</p>
          <div className="inline-block p-4 bg-white rounded-lg">
            {/* QRコードプレースホルダー */}
            <div className="w-48 h-48 bg-gray-200 flex items-center justify-center">
              <span className="text-gray-500">デモQR</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}