const Group = require("../js/Group");
const User = require("../js/user");
const bcrypt = require("bcrypt");
const Diary = require("../js/diary");

// 그룹 생성
exports.createGroup = async (req, res) => {
  const { name, password } = req.body;
  const leaderId = req.user.id;

  try {
    let hashedPassword = null;

    if (password) {
      hashedPassword = await bcrypt.hash(password, 10); // 👉 비밀번호가 있을 경우에만 해시
    }

    const group = new Group({
      name,
      leader: leaderId,
      members: [leaderId],
      invitations: [],
      password: hashedPassword, // 👉 null 또는 해시된 비번
    });

    await group.save();
    res.status(201).json({ groupId: group._id });
  } catch (err) {
    console.error("❌ 그룹 생성 오류:", err);
    res.status(500).json({ message: "그룹 생성 실패" });
  }
};

// 그룹에 사용자 초대
exports.inviteUsers = async (req, res) => {
  const { groupId } = req.params;
  const { userEmails } = req.body;

  try {
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "그룹을 찾을 수 없음" });

    const users = await User.find({ email: { $in: userEmails } });
    users.forEach((user) => {
      if (
        !group.invitations.includes(user._id) &&
        !group.members.includes(user._id)
      ) {
        group.invitations.push(user._id);
      }
    });

    await group.save();
    res.json({ message: "초대 완료" });
  } catch (err) {
    console.error("❌ 초대 오류:", err);
    res.status(500).json({ message: "초대 실패" });
  }
};

// 초대 목록 조회
exports.getInvitations = async (req, res) => {
  const userId = req.user.id;

  try {
    const groups = await Group.find({ invitations: userId }).populate("leader", "name");

    const result = groups.map((group) => ({
      groupId: group._id,
      groupName: group.name,
      inviterName: group.leader.name,
    }));

    res.json(result);
  } catch (err) {
    console.error("❌ 초대 목록 오류:", err);
    res.status(500).json({ message: "초대 목록 불러오기 실패" });
  }
};

// 초대 수락
exports.acceptInvite = async (req, res) => {
  const userId = req.user.id;
  const { groupId } = req.params;

  try {
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "그룹 없음" });

    if (!group.members.includes(userId)) {
      group.members.push(userId);
    }

    group.invitations = group.invitations.filter(
      (id) => id.toString() !== userId
    );

    await group.save();
    res.json({ message: "초대 수락" });
  } catch (err) {
    console.error("❌ 초대 수락 오류:", err);
    res.status(500).json({ message: "수락 실패" });
  }
};

// 초대 거절
exports.rejectInvite = async (req, res) => {
  const userId = req.user.id;
  const { groupId } = req.params;

  try {
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "그룹 없음" });

    group.invitations = group.invitations.filter(
      (id) => id.toString() !== userId
    );

    await group.save();
    res.json({ message: "초대 거절" });
  } catch (err) {
    console.error("❌ 초대 거절 오류:", err);
    res.status(500).json({ message: "거절 실패" });
  }
};

// ✅ [수정] 내 그룹 목록 조회 - leader와 members 모두 populate
exports.getMyGroups = async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user._id })
      .populate("leader", "name")
      .populate("members", "name email")
      .lean(); // ← plain object로 변환 (💡 반드시 필요)

    const result = groups.map(group => ({
      ...group,
      hasPassword: !!group.password, // ✅ 여기 추가
    }));

    res.status(200).json(result);
  } catch (err) {
    console.error("❌ 내 그룹 목록 조회 실패:", err);
    res.status(500).json({ message: "서버 오류" });
  }
};


// 특정 그룹 구성원 조회
exports.getGroupMembers = async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await Group.findById(groupId).populate("members", "name email");

    if (!group) {
      return res.status(404).json({ message: "그룹을 찾을 수 없습니다." });
    }

    res.status(200).json({ members: group.members });
  } catch (err) {
    console.error("❌ 그룹 구성원 조회 실패:", err);
    res.status(500).json({ message: "서버 오류" });
  }
};

exports.verifyGroupPassword = async (req, res) => {
  const { groupId } = req.params;
  const { password } = req.body;

  try {
      const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "그룹을 찾을 수 없습니다." });
    }

    const isMatch = await bcrypt.compare(password, group.password);
    if (!isMatch) {
      return res.status(403).json({ message: "비밀번호가 틀렸습니다." });
    }

    // 통과 ✅
    return res.status(200).json({ message: "비밀번호 인증 성공!" });
  } catch (err) {
    console.error("비밀번호 확인 오류:", err);
    return res.status(500).json({ message: "서버 오류" });
  }
};
    
exports.removeMember = async (req, res) => {
  const { groupId, memberId } = req.params;
  const currentUserId = req.user.id;

  try {
    if (currentUserId === memberId) {
      return res.status(400).json({ message: "자기 자신은 삭제할 수 없습니다." });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "그룹을 찾을 수 없습니다." });
    }

    // 🔒 리더가 아닐 경우 거부
    if (String(group.leader) !== String(currentUserId)) {
      return res.status(403).json({ message: "그룹 구성원을 삭제할 권한이 없습니다." });
    }

    // 삭제
    group.members = group.members.filter(id => id.toString() !== memberId);
    await group.save();

    res.status(200).json({ message: "구성원 삭제 완료" });
  } catch (err) {
    console.error("❌ 그룹 구성원 삭제 실패:", err);
    res.status(500).json({ message: "구성원 삭제 실패" });
  }
};

exports.updateGroupPassword = async (req, res) => {
  const { groupId } = req.params;
  const { newPassword } = req.body;
  const userId = req.user.id;

  try {
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "그룹을 찾을 수 없습니다." });
    }

    // 권한 확인: 그룹장만 변경 가능
    if (group.leader.toString() !== userId) {
      return res.status(403).json({ message: "비밀번호를 변경할 권한이 없습니다." });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    group.password = hashed;
    await group.save();

    return res.status(200).json({ message: "비밀번호가 변경되었습니다." });
  } catch (err) {
    console.error("❌ 비밀번호 변경 오류:", err);
    return res.status(500).json({ message: "서버 오류" });
  }
};


exports.deleteGroup = async (req, res) => {
  const { groupId } = req.params;
  const userId = req.user._id;

  try {
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "그룹을 찾을 수 없습니다." });

    if (String(group.leader) !== String(userId)) {
      return res.status(403).json({ message: "그룹 삭제 권한이 없습니다." });
    }

    // ✅ 그룹에 속한 모든 일기 삭제
    await Diary.deleteMany({ group: groupId });

    // ✅ 그룹 삭제
    await Group.findByIdAndDelete(groupId);

    res.status(200).json({ message: "그룹과 일기가 모두 삭제되었습니다." });
  } catch (err) {
    console.error("❌ 그룹 삭제 실패:", err);
    res.status(500).json({ message: "서버 오류" });
  }
};
