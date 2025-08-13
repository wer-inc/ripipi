export default function ValueProposition() {
  const values = [
    {
      title: "ノーショー削減",
      description: "前日/直前の自動通知と事前決済で、\"忘れてた\"を防止",
      icon: (
        <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      stat: "▲30%",
      statLabel: "平均削減率",
    },
    {
      title: "リピート増",
      description: "会員証・ポイント・回数券で再来導線をつくる",
      icon: (
        <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ),
      stat: "+10%",
      statLabel: "再来率向上",
    },
    {
      title: "運用の軽さ",
      description: "予約も会員もLINEひとつ。スタッフ教育コストほぼゼロ",
      icon: (
        <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      ),
      stat: "0分",
      statLabel: "スタッフ教育",
    },
  ];

  return (
    <section className="py-20 px-4 bg-gray-50/50">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            なぜLINE予約なのか
          </h2>
          <p className="text-lg text-gray-600">
            日本で最も使われているメッセージアプリだから、お客様の負担が最小限
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {values.map((value, index) => (
            <div
              key={index}
              className="group bg-white p-8 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
            >
              <div className="flex justify-center mb-6">
                <div className="p-4 bg-emerald-50 rounded-2xl text-emerald-600 group-hover:bg-emerald-100 transition-colors">
                  {value.icon}
                </div>
              </div>
              <div className="text-center">
                <h3 className="text-xl font-bold mb-2">{value.title}</h3>
                <p className="text-gray-600 mb-4">{value.description}</p>
                <div className="pt-4 border-t border-gray-100">
                  <div className="text-3xl font-bold text-emerald-600">{value.stat}</div>
                  <div className="text-sm text-gray-500">{value.statLabel}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}