// The chat's made-up colleagues and their short, static conversations, and the project
// space the boss key shows. Plain office talk, no story in it, nothing fetched.

export type Presence = "active" | "away" | "busy";

export interface FakeLine {
  // "me" is the reader; anyone else is the contact (or, in the decoy, a team member).
  from: string;
  time: string;
  text: string;
}

export interface FakeContact {
  id: string;
  name: string;
  tone: number;
  presence: Presence;
  day: string;
  lines: FakeLine[];
}

export const CONTACTS: FakeContact[] = [
  {
    id: "thu-ha",
    name: "Thu Hà",
    tone: 3,
    presence: "active",
    day: "Today",
    lines: [
      { from: "them", time: "8:52 AM", text: "Em ơi, bản đối soát tháng 9 chị để trong thư mục chung rồi nhé." },
      { from: "them", time: "8:52 AM", text: "Có mấy dòng chênh lệch ở tab Chi tiết, em xem giúp chị trước 3h chiều được không?" },
      { from: "me", time: "9:05 AM", text: "Dạ được chị, em xem xong em nhắn lại ạ." },
      { from: "them", time: "9:06 AM", text: "Ok em, cảm ơn em nha 🙏" },
    ],
  },
  {
    id: "minh-tuan",
    name: "Minh Tuấn",
    tone: 2,
    presence: "busy",
    day: "Yesterday",
    lines: [
      { from: "them", time: "4:18 PM", text: "Mai họp review lúc 10h hay 2h vậy anh?" },
      { from: "me", time: "4:21 PM", text: "2h chiều nhé, sáng anh bận gặp khách." },
      { from: "them", time: "4:22 PM", text: "Dạ, em dời lịch trên calendar luôn." },
    ],
  },
  {
    id: "hai-yen",
    name: "Hải Yến",
    tone: 5,
    presence: "away",
    day: "Monday, September 29",
    lines: [
      { from: "them", time: "11:40 AM", text: "Trưa nay cả nhóm ăn cơm văn phòng hay ra ngoài vậy mọi người?" },
      { from: "me", time: "11:42 AM", text: "Mình đặt cơm nhé, chiều còn họp sớm." },
      { from: "them", time: "11:43 AM", text: "Ok, Yến đặt chung luôn 5 phần." },
    ],
  },
  {
    id: "quoc-bao",
    name: "Quốc Bảo",
    tone: 4,
    presence: "active",
    day: "Friday, September 26",
    lines: [
      { from: "them", time: "3:02 PM", text: "Anh ơi, máy in tầng 3 lại kẹt giấy rồi 😅" },
      { from: "me", time: "3:10 PM", text: "Em báo bên hành chính giúp anh nhé, anh đang ở ngoài." },
      { from: "them", time: "3:11 PM", text: "Dạ em báo rồi ạ." },
    ],
  },
];

// ---- The decoy: a project team space -------------------------------------------------

export interface DecoyMember {
  name: string;
  tone: number;
}

export const DECOY_MEMBERS: Record<string, DecoyMember> = {
  lan: { name: "Lan Anh", tone: 1 },
  tuan: { name: "Minh Tuấn", tone: 2 },
  ha: { name: "Thu Hà", tone: 3 },
  long: { name: "Đức Long", tone: 6 },
  me: { name: "You", tone: 0 },
};

export type DecoyItem =
  | { kind: "day"; label: string }
  | { kind: "message"; from: keyof typeof DECOY_MEMBERS; time: string; text: string }
  | { kind: "doc"; from: keyof typeof DECOY_MEMBERS; time: string; text: string; file: string; detail: string }
  | {
      kind: "meeting";
      from: keyof typeof DECOY_MEMBERS;
      time: string;
      text: string;
      title: string;
      when: string;
      room: string;
    };

export const DECOY_SPACE = "Dự án Cổng thanh toán";

export const DECOY_SPACES = [
  { name: DECOY_SPACE, unread: 0, active: true },
  { name: "Phòng Kế toán", unread: 3, active: false },
  { name: "Thông báo chung", unread: 0, active: false },
  { name: "Đối soát Q4", unread: 1, active: false },
  { name: "Hỗ trợ IT", unread: 0, active: false },
];

export const DECOY_ITEMS: DecoyItem[] = [
  { kind: "day", label: "Yesterday" },
  {
    kind: "message",
    from: "lan",
    time: "4:35 PM",
    text: "Mọi người ơi, bên khách hàng chốt deadline UAT là thứ Sáu tuần này nhé. Mình cần xong phần đối soát giao dịch trước thứ Năm.",
  },
  { kind: "message", from: "lan", time: "4:35 PM", text: "Ai còn vướng gì thì nói sớm để mình sắp xếp lại." },
  {
    kind: "message",
    from: "tuan",
    time: "4:41 PM",
    text: "API hoàn tiền em xong rồi, đang chờ môi trường test của đối tác. Họ hẹn sáng mai mở lại.",
  },
  { kind: "day", label: "Today" },
  {
    kind: "doc",
    from: "ha",
    time: "9:12 AM",
    text: "Chị cập nhật đặc tả mục 4.2 (luồng hoàn tiền một phần), mọi người xem và comment trực tiếp trong tài liệu nhé.",
    file: "Dac_ta_API_thanh_toan_v2.3",
    detail: "Tài liệu · Đã chỉnh sửa 9:10 AM",
  },
  {
    kind: "message",
    from: "long",
    time: "9:20 AM",
    text: "Test case cho luồng hoàn tiền em viết được 32/40 rồi, chiều nay em đẩy lên bộ test chung.",
  },
  {
    kind: "message",
    from: "me",
    time: "9:26 AM",
    text: "Ok mọi người. Mình gom các điểm còn mở lại để review một lượt trước khi gửi khách.",
  },
  {
    kind: "meeting",
    from: "lan",
    time: "9:31 AM",
    text: "Mình đặt lịch review nhanh chiều nay nhé.",
    title: "Review tiến độ UAT – Cổng thanh toán",
    when: "Hôm nay · 2:00 – 2:30 PM",
    room: "Phòng họp Sen (tầng 5) · Họp trực tuyến",
  },
  { kind: "message", from: "tuan", time: "9:33 AM", text: "Em vào được ạ 👍" },
  {
    kind: "message",
    from: "ha",
    time: "9:40 AM",
    text: "Nhắc thêm: số liệu đối soát tháng 9 có 3 giao dịch lệch ở bảng Chi tiết, Long kiểm tra giúp chị trước buổi họp được không?",
  },
  { kind: "message", from: "long", time: "9:42 AM", text: "Dạ để em xem luôn ạ." },
];
