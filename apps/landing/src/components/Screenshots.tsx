export default function Screenshots() {
  const screens = [
    {
      title: "予約画面",
      description: "日時・メニュー・スタッフを選択",
      placeholder: "予約画面\nスクリーンショット",
    },
    {
      title: "会員証画面",
      description: "スタンプ・ポイント・回数券を表示",
      placeholder: "会員証画面\nスクリーンショット",
    },
    {
      title: "管理画面",
      description: "当日の予約一覧をリアルタイム確認",
      placeholder: "管理画面\nスクリーンショット",
    },
  ];

  return (
    <section className="py-16 px-4">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-4">
          実際の画面
        </h2>
        <p className="text-center text-gray-600 mb-12">
          お客様も店舗スタッフも使いやすい、シンプルなUI
        </p>
        <div className="grid md:grid-cols-3 gap-8">
          {screens.map((screen, index) => (
            <div key={index} className="text-center">
              <div className="bg-gray-100 rounded-xl aspect-[9/16] max-w-xs mx-auto mb-4 flex items-center justify-center text-gray-400">
                <p className="whitespace-pre-line text-sm">{screen.placeholder}</p>
              </div>
              <h3 className="font-bold mb-1">{screen.title}</h3>
              <p className="text-sm text-gray-600">{screen.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}