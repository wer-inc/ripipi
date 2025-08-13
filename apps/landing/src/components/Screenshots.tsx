export default function Screenshots() {
  const screens = [
    {
      title: "予約画面（お客様）",
      description: "日時・メニュー・スタッフを簡単選択",
      mockup: (
        <div className="p-4 space-y-3">
          <div className="bg-emerald-500 text-white p-3 rounded-xl text-sm font-medium">予約選択</div>
          <div className="space-y-2">
            <div className="bg-gray-200 h-10 rounded-lg animate-pulse" />
            <div className="bg-gray-200 h-10 rounded-lg animate-pulse" />
            <div className="bg-gray-200 h-10 rounded-lg animate-pulse" />
          </div>
          <div className="grid grid-cols-7 gap-1 text-xs">
            {[...Array(7)].map((_, i) => (
              <div key={i} className="bg-gray-100 p-2 rounded text-center">
                {i + 1}
              </div>
            ))}
          </div>
          <button className="w-full bg-emerald-500 text-white py-3 rounded-xl text-sm font-medium">
            予約確定
          </button>
        </div>
      ),
    },
    {
      title: "会員証画面（お客様）",
      description: "スタンプ・ポイント・回数券を一元管理",
      mockup: (
        <div className="p-4 space-y-3">
          <div className="bg-emerald-500 text-white p-3 rounded-xl text-sm font-medium">会員証</div>
          <div className="bg-white border-2 border-gray-200 rounded-xl p-4">
            <div className="grid grid-cols-5 gap-2 mb-3">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className={`w-8 h-8 rounded-full ${
                    i < 7 ? 'bg-emerald-500' : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-gray-600">あと3個でクーポン獲得</p>
          </div>
          <div className="bg-gray-100 p-3 rounded-lg">
            <p className="text-xs font-medium">回数券残り: 3回</p>
          </div>
          <div className="bg-gray-100 p-3 rounded-lg">
            <p className="text-xs font-medium">ポイント: 250P</p>
          </div>
        </div>
      ),
    },
    {
      title: "管理画面（店舗）",
      description: "当日予約をリアルタイム確認",
      mockup: (
        <div className="p-4 space-y-3">
          <div className="bg-blue-600 text-white p-3 rounded-xl text-sm font-medium">本日の予約</div>
          <div className="space-y-2">
            <div className="bg-white border border-gray-200 rounded-lg p-2 text-xs">
              <div className="flex justify-between">
                <span className="font-medium">10:00 田中様</span>
                <span className="text-emerald-600">確定</span>
              </div>
              <p className="text-gray-500">カット・カラー</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-2 text-xs">
              <div className="flex justify-between">
                <span className="font-medium">11:30 佐藤様</span>
                <span className="text-emerald-600">確定</span>
              </div>
              <p className="text-gray-500">カット</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-2 text-xs">
              <div className="flex justify-between">
                <span className="font-medium">13:00 鈴木様</span>
                <span className="text-orange-500">未確認</span>
              </div>
              <p className="text-gray-500">パーマ</p>
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <section className="py-20 px-4 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            実際の画面イメージ
          </h2>
          <p className="text-lg text-gray-600">
            お客様も店舗スタッフも迷わない、直感的なUI
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {screens.map((screen, index) => (
            <div key={index} className="group">
              <div className="relative">
                {/* Phone frame */}
                <div className="bg-gray-900 rounded-[2.5rem] p-3 shadow-2xl group-hover:shadow-3xl transition-all duration-300 transform group-hover:scale-105">
                  <div className="bg-gray-100 rounded-[2rem] overflow-hidden">
                    {/* Status bar */}
                    <div className="bg-gray-900 text-white px-4 py-1 text-xs flex justify-between">
                      <span>9:41</span>
                      <div className="flex items-center gap-1">
                        <div className="w-4 h-3 border border-white rounded-sm"></div>
                        <div className="w-1 h-3 bg-white rounded-sm"></div>
                      </div>
                    </div>
                    {/* Screen content */}
                    <div className="bg-white min-h-[400px]">
                      {screen.mockup}
                    </div>
                  </div>
                </div>
                {/* Notch */}
                <div className="absolute top-6 left-1/2 transform -translate-x-1/2 w-20 h-6 bg-gray-900 rounded-b-xl"></div>
              </div>
              <div className="text-center mt-6">
                <h3 className="font-bold text-lg mb-2">{screen.title}</h3>
                <p className="text-gray-600">{screen.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}