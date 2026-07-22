import type {
  CategoryId,
  CategoryRubric,
  DimensionKey,
  EvidenceSlot,
  RubricDimension,
} from "@/lib/domain/types";

export const RUBRIC_VERSION = "2026-07-21.v1";

export const DIMENSIONS: RubricDimension[] = [
  {
    key: "strategic_value",
    label: "战略价值",
    weight: 20,
    question: "是否解决重要问题，是否符合小团队的目标与方向",
  },
  {
    key: "demand_evidence",
    label: "需求证据",
    weight: 20,
    question: "需求是否真实、迫切并可验证",
  },
  {
    key: "return_potential",
    label: "收益潜力",
    weight: 15,
    question: "收入、降本、效率或其他回报是否值得投入",
  },
  {
    key: "execution_feasibility",
    label: "执行可行性",
    weight: 15,
    question: "技术、渠道、供应链和交付路径是否可行",
  },
  {
    key: "resource_fit",
    label: "资源匹配度",
    weight: 15,
    question: "人员、资金、能力和时间是否匹配",
  },
  {
    key: "timing_differentiation",
    label: "时机与差异化",
    weight: 5,
    question: "是否存在窗口期和有意义的竞争优势",
  },
  {
    key: "risk_control",
    label: "风险可控性",
    weight: 10,
    question: "合规、市场、技术和经营风险是否可控制",
  },
];

const COMMON_SLOTS: Record<DimensionKey, EvidenceSlot[]> = {
  strategic_value: [
    {
      id: "strategic_problem_importance",
      label: "问题重要性",
      description: "项目解决的问题对目标用户或业务是否重要",
    },
    {
      id: "strategic_alignment",
      label: "团队方向匹配",
      description: "是否符合小团队当前目标与长期方向",
    },
    {
      id: "strategic_focus_cost",
      label: "机会成本",
      description: "不做的成本或同时放弃的其他机会是否可接受",
    },
  ],
  demand_evidence: [
    {
      id: "demand_signal",
      label: "需求信号",
      description: "是否存在真实用户/客户表达的需求信号",
    },
    {
      id: "demand_urgency",
      label: "需求迫切性",
      description: "需求解决的紧迫程度",
    },
    {
      id: "demand_verifiability",
      label: "需求可验证性",
      description: "是否有可复查的数据或试验验证需求",
    },
  ],
  return_potential: [
    {
      id: "return_size",
      label: "回报规模",
      description: "潜在收入、降本或效率提升的规模",
    },
    {
      id: "return_timing",
      label: "回报周期",
      description: "预期回收周期是否合理",
    },
  ],
  execution_feasibility: [
    {
      id: "execution_path",
      label: "执行路径",
      description: "是否有清晰的交付路径和关键里程碑",
    },
    {
      id: "execution_dependencies",
      label: "外部依赖",
      description: "关键技术、渠道或供应链依赖是否可控",
    },
    {
      id: "execution_quality_risk",
      label: "质量风险",
      description: "交付质量不达预期的风险",
    },
  ],
  resource_fit: [
    {
      id: "resource_people",
      label: "人员匹配",
      description: "团队是否具备关键技能或可获得",
    },
    {
      id: "resource_budget",
      label: "资金匹配",
      description: "预算是否足以覆盖开发和运营成本",
    },
    {
      id: "resource_time",
      label: "时间窗口",
      description: "可用时间是否满足项目周期",
    },
  ],
  timing_differentiation: [
    {
      id: "timing_window",
      label: "时间窗口",
      description: "是否存在当前进入的有利窗口",
    },
    {
      id: "differentiation",
      label: "差异化",
      description: "相比现有方案是否有明显差异或优势",
    },
  ],
  risk_control: [
    {
      id: "risk_compliance",
      label: "合规风险",
      description: "法律、政策和伦理风险",
    },
    {
      id: "risk_market",
      label: "市场风险",
      description: "需求变化、竞争和价格风险",
    },
    {
      id: "risk_mitigation",
      label: "止损机制",
      description: "是否有明确的止损或退出机制",
    },
  ],
};

const CATEGORY_OVERRIDES: Record<
  CategoryId,
  Partial<Record<DimensionKey, EvidenceSlot[]>> | undefined
> = {
  software: {
    return_potential: [
      {
        id: "software_pricing",
        label: "付费意愿",
        description: "目标用户是否愿意为功能付费及定价模型",
      },
      {
        id: "software_acquisition",
        label: "获客经济",
        description: "获客成本与生命周期价值是否健康",
      },
      {
        id: "software_retention",
        label: "留存预期",
        description: "用户续费、活跃或复购预期",
      },
      {
        id: "software_maintenance",
        label: "维护成本",
        description: "持续开发与维护成本估算",
      },
    ],
  },
  ecommerce: {
    return_potential: [
      {
        id: "ecommerce_margin",
        label: "毛利空间",
        description: "产品毛利是否足够覆盖获客和运营成本",
      },
      {
        id: "ecommerce_repeat",
        label: "复购潜力",
        description: "用户复购频率和忠诚度",
      },
      {
        id: "ecommerce_inventory",
        label: "库存风险",
        description: "库存周转、滞销和资金占用风险",
      },
      {
        id: "ecommerce_acquisition",
        label: "获客成本",
        description: "电商渠道获客成本与转化率",
      },
    ],
  },
  content: {
    return_potential: [
      {
        id: "content_audience",
        label: "受众需求",
        description: "受众规模、需求强度和互动质量",
      },
      {
        id: "content_production",
        label: "持续产能",
        description: "内容生产的可持续性和成本",
      },
      {
        id: "content_monetization",
        label: "变现路径",
        description: "广告、付费、电商或其他变现路径",
      },
      {
        id: "content_acquisition",
        label: "流量获取",
        description: "稳定获取目标受众的渠道和成本",
      },
    ],
  },
  local_service: {
    return_potential: [
      {
        id: "local_service_demand",
        label: "本地需求",
        description: "本地市场需求的稳定性和规模",
      },
      {
        id: "local_service_capacity",
        label: "服务能力",
        description: "服务交付能力和可扩展性",
      },
      {
        id: "local_service_repeat",
        label: "复购与转介绍",
        description: "客户复购和口碑转介绍潜力",
      },
    ],
  },
  internal_efficiency: {
    return_potential: [
      {
        id: "efficiency_time_saved",
        label: "节省工时",
        description: "每周或每月节省的工时数量",
      },
      {
        id: "efficiency_people",
        label: "覆盖人数",
        description: "受益人数和频率",
      },
      {
        id: "efficiency_errors",
        label: "错误减少",
        description: "减少的错误率或返工成本",
      },
      {
        id: "efficiency_payback",
        label: "回收周期",
        description: "投入成本回收所需时间",
      },
    ],
  },
  investment: {
    return_potential: [
      {
        id: "investment_upside",
        label: "上行空间",
        description: "投资回报或战略收益潜力",
      },
      {
        id: "investment_liquidity",
        label: "退出路径",
        description: "资金或股权退出路径是否清晰",
      },
      {
        id: "investment_control",
        label: "影响力",
        description: "对项目或合作方的影响力和信息透明度",
      },
    ],
    risk_control: [
      {
        id: "investment_downside",
        label: "下行风险",
        description: "最坏情况损失及是否威胁团队生存",
      },
      {
        id: "investment_stop_loss",
        label: "止损机制",
        description: "明确的止损或退出机制",
      },
    ],
  },
  general: {},
};

export const CATEGORY_IDS: CategoryId[] = [
  "software",
  "ecommerce",
  "content",
  "local_service",
  "internal_efficiency",
  "investment",
  "general",
];

export function getRubric(category: CategoryId): CategoryRubric {
  const override = CATEGORY_OVERRIDES[category] ?? {};
  const slots = { ...COMMON_SLOTS };

  for (const key of Object.keys(override) as DimensionKey[]) {
    const overrideSlots = override[key];
    if (overrideSlots && overrideSlots.length > 0) {
      slots[key] = overrideSlots;
    }
  }

  return {
    version: RUBRIC_VERSION,
    category,
    label: categoryLabel(category),
    slots,
  };
}

function categoryLabel(category: CategoryId): string {
  const labels: Record<CategoryId, string> = {
    software: "软件或数字产品",
    ecommerce: "电商或零售",
    content: "内容或媒体",
    local_service: "实体服务或本地业务",
    internal_efficiency: "内部效率或流程改进",
    investment: "投资或合作机会",
    general: "通用项目",
  };
  return labels[category];
}

