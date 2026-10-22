// The default skin's decoy: a word-processor page of meeting minutes. Static, no story
// in it, nothing fetched. Drawn with the app's neutral tokens so it follows light/dark.

const AGENDA: { title: string; points: string[] }[] = [
  {
    title: "1. Tiến độ dự án",
    points: [
      "Module thanh toán đã hoàn thành 85%, dự kiến bàn giao cho QA vào thứ Năm.",
      "Còn 3 ticket mức độ cao liên quan đến đồng bộ dữ liệu; anh Minh phụ trách theo dõi.",
      "Báo cáo hiệu năng tuần trước: thời gian phản hồi trung bình giảm từ 420ms xuống 310ms.",
    ],
  },
  {
    title: "2. Kế hoạch Quý 4",
    points: [
      "Ưu tiên ổn định hệ thống trước đợt cao điểm cuối năm.",
      "Rà soát lại chi phí hạ tầng, đề xuất phương án tối ưu trước ngày 15/10.",
      "Chuẩn bị tài liệu hướng dẫn cho nhóm vận hành.",
    ],
  },
  {
    title: "3. Vấn đề cần xử lý",
    points: [
      "Quy trình review code đang chậm, đề xuất mỗi PR có tối đa 2 người review.",
      "Môi trường staging thỉnh thoảng mất kết nối cơ sở dữ liệu, cần kiểm tra lại cấu hình.",
    ],
  },
];

const ACTIONS: [string, string, string][] = [
  ["Hoàn thiện test tích hợp module thanh toán", "Minh", "10/10"],
  ["Gửi báo cáo chi phí hạ tầng", "Lan", "15/10"],
  ["Cập nhật tài liệu vận hành", "Tuấn", "20/10"],
  ["Rà soát quy trình review code", "Hà", "17/10"],
];

export default function DocDecoy() {
  return (
    <div className="flex h-full flex-col bg-chrome text-ink">
      <div className="flex h-11 flex-none items-center gap-3 border-b border-rule bg-raised px-4">
        <span className="grid size-6 place-items-center rounded-tool bg-[#2b579a] text-[13px] font-bold text-white">≡</span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">Biên bản họp giao ban – Tuần 40</div>
          <div className="text-[11px] text-ink-3">Đã lưu vào Tài liệu · Chỉnh sửa lần cuối 2 phút trước</div>
        </div>
        <span className="ml-auto text-[12px] text-ink-2">Chia sẻ</span>
      </div>
      <div className="flex h-8 flex-none items-center gap-4 border-b border-rule bg-raised px-4 text-[12px] text-ink-2">
        <span>Tệp</span>
        <span>Chỉnh sửa</span>
        <span>Xem</span>
        <span>Chèn</span>
        <span>Định dạng</span>
        <span>Công cụ</span>
        <span className="ml-4 border-l border-rule pl-4">Văn bản thường</span>
        <span>Arial</span>
        <span>11</span>
        <span className="font-bold">B</span>
        <span className="italic">I</span>
        <span className="underline">U</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-8">
        <article className="mx-auto max-w-[760px] border border-rule bg-content px-16 py-14 font-[Arial,sans-serif] text-[14px] leading-relaxed text-ink">
          <h1 className="mb-1 text-[22px] font-bold">BIÊN BẢN HỌP GIAO BAN</h1>
          <p className="mb-6 text-ink-2">Tuần 40 · Phòng Phát triển sản phẩm</p>
          <table className="mb-6 w-full border-collapse text-[13px]">
            <tbody>
              {[
                ["Thời gian", "09:00 – 10:30, Thứ Hai"],
                ["Địa điểm", "Phòng họp tầng 5"],
                ["Thành phần", "Nhóm Backend, nhóm Frontend, QA, Quản lý dự án"],
                ["Thư ký", "Nguyễn Thu Hà"],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td className="w-36 border border-rule px-2 py-1 font-semibold">{label}</td>
                  <td className="border border-rule px-2 py-1">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {AGENDA.map((section) => (
            <section key={section.title} className="mb-5">
              <h2 className="mb-2 text-[16px] font-bold">{section.title}</h2>
              <ul className="list-disc pl-6">
                {section.points.map((point) => (
                  <li key={point} className="mb-1">
                    {point}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <h2 className="mb-2 text-[16px] font-bold">4. Phân công công việc</h2>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["Nội dung", "Phụ trách", "Hạn"].map((head) => (
                  <th key={head} className="border border-rule bg-raised px-2 py-1 text-left">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ACTIONS.map(([task, owner, due]) => (
                <tr key={task}>
                  <td className="border border-rule px-2 py-1">{task}</td>
                  <td className="border border-rule px-2 py-1">{owner}</td>
                  <td className="border border-rule px-2 py-1">{due}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-8 text-ink-2">Cuộc họp kết thúc lúc 10:30. Biên bản được gửi tới toàn bộ thành viên tham dự.</p>
        </article>
      </div>
    </div>
  );
}
