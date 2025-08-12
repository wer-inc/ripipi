export default function ValueProposition() {
  const values = [
    {
      title: "ノーショー削減",
      description: "前日/直前の自動通知と事前決済で、\"忘れてた\"を防止",
      icon: "📅",
    },
    {
      title: "リピート増",
      description: "会員証・ポイント・回数券で再来導線をつくる",
      icon: "🔄",
    },
    {
      title: "運用の軽さ",
      description: "予約も会員もLINEひとつ。スタッフ教育コストほぼゼロ",
      icon: "✨",
    },
  ];

  return (
    <section className="py-16 px-4">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          なぜLINE予約なのか
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          {values.map((value, index) => (
            <div
              key={index}
              className="bg-white p-8 rounded-xl shadow-md text-center"
            >
              <div className="text-4xl mb-4">{value.icon}</div>
              <h3 className="text-xl font-bold mb-3">{value.title}</h3>
              <p className="text-gray-700">{value.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}