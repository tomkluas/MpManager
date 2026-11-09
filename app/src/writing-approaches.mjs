export const writingApproaches=[
 {id:'story',name:'生活故事',outline:'从一个具体冲突开场，用人物选择、对话和一个小转折推进，结尾给读者一个今天能做的小行动。'},
 {id:'dialogue',name:'饭局对话',outline:'用两三轮自然对话呈现劝酒与拒绝的难处，给出有分寸、能直接说出口的回应。'},
 {id:'contrast',name:'两种生活对照',outline:'围绕同一个晚上对照两种选择，不夸大后果，把重点落在第二天的感受与可执行的替代安排。'},
 {id:'myth',name:'误区反转',outline:'从一句常见的自我安慰切入，拆解其中的心理误区，用具体场景和替代行动完成转折，不堆医学知识。'},
 {id:'letter',name:'写给明天的自己',outline:'以明确标注的虚构书信表达犹豫、牵挂与决心，用日常细节引发共鸣，不煽情恐吓。'},
 {id:'challenge',name:'一次小挑战',outline:'邀请读者完成一个具体的不喝酒小挑战，按触发时刻、替代动作、复盘问题展开，避免变成功能教程。'},
];
export function selectWritingApproach(history=[],preferred){
 const chosen=writingApproaches.find(x=>x.id===preferred);if(chosen)return chosen;
 const used=history.map(x=>x.writingApproach).filter(Boolean);
 return [...writingApproaches].sort((a,b)=>used.filter(x=>x===a.id).length-used.filter(x=>x===b.id).length)[0];
}
export function writingGuidance(approach){return `本篇写作方案：${approach.name}。${approach.outline} 用户明确指定文体时优先服从用户。围绕读者生活与情绪展开，不用功能清单推动文章。若产品定位涉及戒酒，最终自然引出戒酒意愿与一个可执行行动，产品只在需要的地方轻轻提及一次；其他产品遵循其已确认定位。虚构人物与情节必须在正文自然注明“设想这样一个场景”等，不得包装成真实案例、本人经历、读者来信或效果见证。不要编造医学结论、戒断方案或保证效果，不羞辱饮酒者。`;}
