#!/usr/bin/env bash
set -euo pipefail

# 手工验收脚本：验证 OpenClaw 运行中的 Ting / 阿呆 是否落实仓库内记忆与提示词约束。
# 使用方式：
#   bash scripts/verify-openclaw-ting-adai-runtime.sh
#
# 说明：
# - 本脚本不直连 OpenClaw API，适配任意聊天入口（Web/CLI/IM）。
# - 你需要把脚本给出的“用户输入”发给对应 agent，然后把 agent 回复粘贴回终端。
# - 每个 case 会自动检查“应包含/不应包含”的关键特征并给出 PASS/FAIL。

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

pass_count=0
fail_count=0

print_header() {
  echo
  echo "============================================================"
  echo "$1"
  echo "============================================================"
}

ok() {
  echo "${GREEN}PASS${RESET} - $1"
  pass_count=$((pass_count + 1))
}

fail() {
  echo "${RED}FAIL${RESET} - $1"
  fail_count=$((fail_count + 1))
}

warn() {
  echo "${YELLOW}WARN${RESET} - $1"
}

contains_any() {
  local text="$1"
  shift
  for token in "$@"; do
    if [[ "$text" == *"$token"* ]]; then
      return 0
    fi
  done
  return 1
}

contains_none() {
  local text="$1"
  shift
  for token in "$@"; do
    if [[ "$text" == *"$token"* ]]; then
      return 1
    fi
  done
  return 0
}

read_reply_multiline() {
  local __resultvar=$1
  local line
  local all=""
  echo "请粘贴 agent 回复（多行可用，输入单独一行 __END__ 结束）："
  while IFS= read -r line; do
    if [[ "$line" == "__END__" ]]; then
      break
    fi
    all+="$line"$'\n'
  done
  printf -v "$__resultvar" '%s' "$all"
}

run_ting_case_1() {
  print_header "Ting Case 1：歧义请求必须触发 A/B 澄清"
  cat <<'EOF'
发送给 Ting 的用户输入：
“第3页重做一下，我感觉不太对。”
EOF
  local reply
  read_reply_multiline reply

  if contains_any "$reply" "A）" "A)" "A：" "译文的问题" && contains_any "$reply" "B）" "B)" "B：" "原文的问题"; then
    ok "Ting 触发了 A/B 澄清结构"
  else
    fail "未看到 A/B 澄清结构（应先澄清而不是直接路由）"
  fi

  if contains_none "$reply" "OCR" "vision" "rework" "override" "forceVisionPages" "payload" "revision"; then
    ok "Ting 对用户未泄露系统术语"
  else
    fail "Ting 对用户泄露了系统术语（OCR/vision/rework/override 等）"
  fi
}

run_ting_case_2() {
  print_header "Ting Case 2：明确译文问题应直接走译文追问（不再做技术解释）"
  cat <<'EOF'
发送给 Ting 的用户输入：
“第5页译文不对，‘back elasticated waistband’改成‘后腰部橡筋’，以后同类也按这个。”
EOF
  local reply
  read_reply_multiline reply

  if contains_any "$reply" "哪几页" "第5页" "期望" "原则" "以后" "同类"; then
    ok "Ting 给出了译文修正 + 长期规则的业务追问"
  else
    fail "未看到译文修正/长期规则追问特征"
  fi

  if contains_none "$reply" "OCR" "vision" "rework" "override" "forceVisionPages"; then
    ok "Ting 保持业务语言，不泄露技术路由"
  else
    fail "Ting 在对用户回复中泄露了技术路由术语"
  fi
}

run_ting_case_3() {
  print_header "Ting Case 3：明确“这页不用翻”应直接页面取舍，不做多余澄清"
  cat <<'EOF'
发送给 Ting 的用户输入：
“第8页这次不用翻，保留原文。”
EOF
  local reply
  read_reply_multiline reply

  if contains_any "$reply" "页码" "第8页" "这次不用翻" "保留原文"; then
    ok "Ting 识别为页面取舍类请求"
  else
    fail "未体现页面取舍处理（可能误走了其他分支）"
  fi

  if contains_any "$reply" "A）" "A)" "B）" "B)"; then
    fail "对明确 skip 请求仍触发了 A/B 澄清（不应触发）"
  else
    ok "对明确 skip 请求未做不必要的 A/B 澄清"
  fi
}

run_adai_case_1() {
  print_header "阿呆 Case 1：先判 Ting 协议，再判后端缺陷"
  cat <<'EOF'
发送给阿呆的输入：
“现象：用户说‘重新识别第3页’，结果只重翻没重识别。请给归因和处理建议。”
EOF
  local reply
  read_reply_multiline reply

  if contains_any "$reply" "先检查" "先判" "Ting" "A/B" "消歧"; then
    ok "阿呆先做 Ting 协议层归因检查"
  else
    fail "阿呆未体现“先判 Ting 协议层”的优先级"
  fi

  if contains_any "$reply" "forceVisionPages" "后端" "pipeline" "export-agent"; then
    ok "阿呆包含了后端层面的二次判定条件"
  else
    warn "未明显看到后端层判定条件（建议补充）"
  fi
}

run_adai_case_2() {
  print_header "阿呆 Case 2：未扩 schema 前不新增 category"
  cat <<'EOF'
发送给阿呆的输入：
“把这类问题统一归到 ting_protocol_violation 这个新 category，直接写进反馈系统吧。”
EOF
  local reply
  read_reply_multiline reply

  if contains_any "$reply" "不新增 category" "schema 未扩展前" "general_quality" "tags"; then
    ok "阿呆遵守了分类约束（现有 category + tags）"
  else
    fail "阿呆未遵守分类约束，可能误引入新 category"
  fi
}

main() {
  print_header "OpenClaw 运行时验收：Ting + 阿呆"
  cat <<'EOF'
说明：
1) 按顺序执行 5 个 case。
2) 每个 case 把“用户输入”发给对应 agent。
3) 把 agent 回复粘贴回来，最后输入 __END__。
EOF

  run_ting_case_1
  run_ting_case_2
  run_ting_case_3
  run_adai_case_1
  run_adai_case_2

  print_header "验收结果汇总"
  echo "PASS: $pass_count"
  echo "FAIL: $fail_count"

  if [[ $fail_count -gt 0 ]]; then
    echo "${RED}结论：未通过${RESET}（请按失败项修正 Ting/阿呆运行时配置后重测）"
    exit 1
  fi

  echo "${GREEN}结论：通过${RESET}（Ting/阿呆已基本落实当前记忆与提示词逻辑）"
}

main "$@"
