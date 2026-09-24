import React, { useState, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Calendar,
  FileText,
  CheckSquare,
  FileCheck2,
  Clock,
  Printer,
  Download,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import { Language, PinnedContext, Role, ThematicPlan, LessonPlan, ReportInstance } from '../../shared/types';
import { translations } from '../i18n/translations';
import { Badge } from '../components/Badge';

interface WorkspacePageProps {
  lang: Language;
  role: Role;
  pinnedContext: PinnedContext;
  onNavigateTab: (tab: string) => void;
}

interface MatchedSource {
  id: string;
  title: string;
  version: string;
  role: string;
}

interface PendingIntent {
  intent: 'generate_thematic_plan' | 'generate_lesson_plan' | 'load_report';
  resolvedSubject: string;
  resolvedGrade: number;
  topic?: string;
  matchedSources: MatchedSource[];
  resolved?: boolean;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  actionArtifact?: {
    type: 'thematic_plan' | 'lesson_plan' | 'report' | 'assessment';
    data: any;
  };
  pendingIntent?: PendingIntent;
}

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const WorkspacePage: React.FC<WorkspacePageProps> = ({
  lang,
  role,
  pinnedContext,
  onNavigateTab,
}) => {
  const t = translations[lang];

  // Canvas active artifact state
  const [activeArtifactType, setActiveArtifactType] = useState<'thematic_plan' | 'lesson_plan' | 'report' | 'empty'>('thematic_plan');
  const [activeThematicPlan, setActiveThematicPlan] = useState<ThematicPlan | null>(null);
  const [activeLessonPlan, setActiveLessonPlan] = useState<LessonPlan | null>(null);
  const [activeReport, setActiveReport] = useState<ReportInstance | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Chat state
  const [inputMessage, setInputMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-welcome',
      sender: 'assistant',
      text: `Բարի գալուստ TeachFlow 3.0 աշխատանքային տարածք: Դուք մուտք եք գործել որպես «${t.roles[role]}»: Ակտիվ առարկան՝ ${pinnedContext.subject}, ${pinnedContext.grade}-րդ դասարան (տարբերակ՝ ${pinnedContext.programVersion}): Ինչո՞վ կարող եմ օգնել:`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  // Load default demo thematic plan for current subject/grade
  useEffect(() => {
    fetchThematicPlans();
  }, [pinnedContext.subject, pinnedContext.grade]);

  const fetchThematicPlans = async () => {
    try {
      const res = await fetch(`/api/thematic-plans?subject=${encodeURIComponent(pinnedContext.subject)}&grade=${pinnedContext.grade}`);
      const data = await res.json();
      if (data.plans && data.plans.length > 0) {
        setActiveThematicPlan(data.plans[0]);
        setActiveArtifactType('thematic_plan');
      }
    } catch (err) {
      console.error('Failed to fetch thematic plans:', err);
    }
  };

  const intentLabel = (intent: PendingIntent['intent']): string => {
    if (intent === 'generate_thematic_plan') return 'ստեղծել թեմատիկ պլան';
    if (intent === 'generate_lesson_plan') return 'ստեղծել դասի պլան';
    return 'բեռնել հաշվետվությունը';
  };

  const handleSendMessage = async (textToSend?: string) => {
    const query = textToSend || inputMessage;
    if (!query.trim()) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: nowLabel(),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputMessage('');
    setIsLoading(true);

    try {
      // Structured intent parse — no keyword matching. The model decides what
      // the teacher wants; we only ever act after they confirm it below.
      const res = await fetch('/api/workspace/parse-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          subject: pinnedContext.subject,
          grade: pinnedContext.grade,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `res-${Date.now()}`,
            sender: 'assistant',
            text: `Հարցումը մշակել չհաջողվեց. ${data.error || 'անհայտ սխալ'}`,
            timestamp: nowLabel(),
          },
        ]);
        return;
      }

      if (data.intent === 'unclear') {
        setMessages((prev) => [
          ...prev,
          {
            id: `res-${Date.now()}`,
            sender: 'assistant',
            text: data.clarifyingQuestion || 'Կարո՞ղ եք ճշտել, թե ինչ եք ցանկանում անել:',
            timestamp: nowLabel(),
          },
        ]);
        return;
      }

      const pendingIntent: PendingIntent = {
        intent: data.intent,
        resolvedSubject: data.resolvedSubject,
        resolvedGrade: data.resolvedGrade,
        topic: data.topic,
        matchedSources: data.matchedSources || [],
      };

      const topicNote = pendingIntent.topic ? ` («${pendingIntent.topic}» թեմայով)` : '';
      setMessages((prev) => [
        ...prev,
        {
          id: `res-${Date.now()}`,
          sender: 'assistant',
          text: `Հասկացա. ցանկանում եք ${intentLabel(pendingIntent.intent)}${topicNote}՝ ${pendingIntent.resolvedSubject}, ${pendingIntent.resolvedGrade}-րդ դասարան: ${
            pendingIntent.matchedSources.length > 0
              ? 'Ստորև՝ գրանցամատյանի աղբյուրները, որոնց վրա հիմնված կլինի արդյունքը: Հաստատեք, որ շարունակենք:'
              : 'Գրանցամատյանում այս առարկայի/դասարանի համար ՓԱՍՏԱՑԻ աղբյուր չգտա. գեներացումը կարող է մերժվել: Հաստատեք միայն, եթե համոզված եք:'
          }`,
          timestamp: nowLabel(),
          pendingIntent,
        },
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `res-${Date.now()}`,
          sender: 'assistant',
          text: 'Ցանցային սխալ: Փորձեք կրկին:',
          timestamp: nowLabel(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Generation parameters for a thematic plan confirmed from chat. Asked for
  // in the confirmation chip — the previous 2 h/week · 68 h/year were invented
  // and ended up inside the generated plan as if they came from the program.
  const [planParams, setPlanParams] = useState({ weeklyHours: '', totalAnnualHours: '', teacherName: '' });
  const planParamsReady =
    /^[1-9][0-9]*$/.test(planParams.weeklyHours.trim()) &&
    /^[1-9][0-9]*$/.test(planParams.totalAnnualHours.trim()) &&
    planParams.teacherName.trim() !== '';

  const handleCancelIntent = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.pendingIntent ? { ...m, pendingIntent: { ...m.pendingIntent, resolved: true } } : m
      )
    );
  };

  const handleConfirmIntent = async (msgId: string, pendingIntent: PendingIntent) => {
    if (pendingIntent.intent === 'generate_thematic_plan' && !planParamsReady) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.pendingIntent ? { ...m, pendingIntent: { ...m.pendingIntent, resolved: true } } : m
      )
    );
    setIsLoading(true);

    try {
      if (pendingIntent.intent === 'generate_thematic_plan') {
        const res = await fetch('/api/thematic-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: pendingIntent.resolvedSubject,
            grade: pendingIntent.resolvedGrade,
            programVersion: pinnedContext.programVersion,
            academicYear: pinnedContext.academicYear,
            schoolId: pinnedContext.schoolId,
            teacherName: planParams.teacherName.trim(),
            weeklyHours: Number(planParams.weeklyHours),
            totalAnnualHours: Number(planParams.totalAnnualHours),
          }),
        });
        const resData = await res.json();
        if (res.ok && resData.plan) {
          setActiveThematicPlan(resData.plan);
          setActiveArtifactType('thematic_plan');
          setMessages((prev) => [
            ...prev,
            {
              id: `res-${Date.now()}`,
              sender: 'assistant',
              text: `Ստեղծվել է ${pendingIntent.resolvedSubject} ${pendingIntent.resolvedGrade}-րդ դասարանի տարեկան թեմատիկ պլանը: Դիտեք աջ վահանակում:`,
              timestamp: nowLabel(),
              actionArtifact: { type: 'thematic_plan', data: resData.plan },
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: `res-${Date.now()}`, sender: 'assistant', text: `Ձախողվեց. ${resData.error || ''}`, timestamp: nowLabel() },
          ]);
        }
      } else if (pendingIntent.intent === 'generate_lesson_plan') {
        // Same API as ThematicPlansPage: resolve/load the thematic plan for
        // the resolved subject/grade, then find the row matching the parsed
        // topic (never just "the first row").
        let plan = activeThematicPlan;
        if (!plan || plan.subject !== pendingIntent.resolvedSubject || plan.grade !== pendingIntent.resolvedGrade) {
          const planRes = await fetch(
            `/api/thematic-plans?subject=${encodeURIComponent(pendingIntent.resolvedSubject)}&grade=${pendingIntent.resolvedGrade}`
          );
          const planData = await planRes.json();
          plan = planData.plans?.[0] || null;
        }

        if (!plan) {
          setMessages((prev) => [
            ...prev,
            {
              id: `res-${Date.now()}`,
              sender: 'assistant',
              text: `${pendingIntent.resolvedSubject}, ${pendingIntent.resolvedGrade}-րդ դասարանի համար թեմատիկ պլան դեռ չկա: Նախ ստեղծեք թեմատիկ պլան:`,
              timestamp: nowLabel(),
            },
          ]);
          return;
        }

        const normalizedTopic = (pendingIntent.topic || '').trim().toLowerCase();
        const matchedRow =
          (normalizedTopic &&
            plan.rows.find((r) => r.topic.toLowerCase().includes(normalizedTopic))) ||
          plan.rows.find((r) => !r.taught) ||
          plan.rows[0];

        if (!matchedRow) {
          setMessages((prev) => [
            ...prev,
            { id: `res-${Date.now()}`, sender: 'assistant', text: 'Թեմատիկ պլանում տողեր չկան:', timestamp: nowLabel() },
          ]);
          return;
        }

        const res = await fetch('/api/lesson-plans/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ thematicPlanId: plan.id, rowId: matchedRow.id, durationMinutes: 45 }),
        });
        const resData = await res.json();
        if (res.ok && resData.lessonPlan) {
          setActiveThematicPlan(plan);
          setActiveLessonPlan(resData.lessonPlan);
          setActiveArtifactType('lesson_plan');
          const topicMatchNote =
            normalizedTopic && !matchedRow.topic.toLowerCase().includes(normalizedTopic)
              ? ` (Ուշադրություն. ձեր նշած թեման ուղիղ չհամընկավ, ընտրվեց ամենամոտ չանցած թեման)`
              : '';
          setMessages((prev) => [
            ...prev,
            {
              id: `res-${Date.now()}`,
              sender: 'assistant',
              text: `Պատրաստ է. «${matchedRow.topic}» թեմայով 45 րոպեանոց դասի պլանը գեներացվել է${topicMatchNote}: Դիտեք աջ վահանակում:`,
              timestamp: nowLabel(),
              actionArtifact: { type: 'lesson_plan', data: resData.lessonPlan },
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: `res-${Date.now()}`, sender: 'assistant', text: `Ձախողվեց. ${resData.error || ''}`, timestamp: nowLabel() },
          ]);
        }
      } else if (pendingIntent.intent === 'load_report') {
        const repRes = await fetch(`/api/reports?schoolId=${pinnedContext.schoolId}`);
        const repData = await repRes.json();
        if (repData.reports && repData.reports.length > 0) {
          setActiveReport(repData.reports[0]);
          setActiveArtifactType('report');
          setMessages((prev) => [
            ...prev,
            {
              id: `res-${Date.now()}`,
              sender: 'assistant',
              text: `Բեռնվեց «${repData.reports[0].title}» հաշվետվությունը: Դիտեք աջ վահանակում:`,
              timestamp: nowLabel(),
              actionArtifact: { type: 'report', data: repData.reports[0] },
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: `res-${Date.now()}`, sender: 'assistant', text: 'Հասանելի հաշվետվություն չգտնվեց:', timestamp: nowLabel() },
          ]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (activeArtifactType === 'thematic_plan' && activeThematicPlan) {
      window.open(`/api/thematic-plans/${activeThematicPlan.id}/export/csv`, '_blank');
    } else if (activeArtifactType === 'report' && activeReport) {
      window.open(`/api/reports/${activeReport.id}/export/csv`, '_blank');
    }
  };

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col bg-gray-100">
      {/* 3-Pane Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Pane 1: Mini Navigation / Fast Switcher */}
        <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
          <div className="p-3 border-b border-gray-100 text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
            <BookOpen className="w-4 h-4 text-indigo-600" />
            Արտեֆակտներ
          </div>
          <nav className="p-2 space-y-1 overflow-y-auto flex-1 text-xs">
            <button
              onClick={() => {
                setActiveArtifactType('thematic_plan');
                fetchThematicPlans();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg font-medium text-left transition-colors ${
                activeArtifactType === 'thematic_plan'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Calendar className="w-4 h-4 text-indigo-600" />
              <span>Թեմատիկ պլան</span>
            </button>

            <button
              onClick={() => {
                if (activeLessonPlan) setActiveArtifactType('lesson_plan');
                else handleSendMessage('Գեներացնել դասի պլան');
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg font-medium text-left transition-colors ${
                activeArtifactType === 'lesson_plan'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Clock className="w-4 h-4 text-emerald-600" />
              <span>Դասի պլան (45ր)</span>
            </button>

            <button
              onClick={() => onNavigateTab('autoGrading')}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg font-medium text-left text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <CheckSquare className="w-4 h-4 text-amber-600" />
              <span>Թեստեր և Ավտոստուգում</span>
            </button>

            <button
              onClick={() => {
                setActiveArtifactType('report');
                handleSendMessage('Բեռնել հաշվետվությունը');
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg font-medium text-left transition-colors ${
                activeArtifactType === 'report'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <FileText className="w-4 h-4 text-blue-600" />
              <span>Հաշվետվություն</span>
            </button>

            <button
              onClick={() => onNavigateTab('aiReview')}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg font-medium text-left text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <FileCheck2 className="w-4 h-4 text-purple-600" />
              <span>AI Փորձաքննություն</span>
            </button>
          </nav>

          {/* Quick Context Summary in Pane 1 */}
          <div className="p-3 bg-gray-50 border-t border-gray-200 text-[11px] text-gray-600 space-y-1">
            <div className="font-semibold text-gray-800">Դեր՝ {t.roles[role]}</div>
            <div>{pinnedContext.subject}, {pinnedContext.grade}-րդ դաս.</div>
            <div className="text-gray-700 font-mono text-[10px]">Տարբերակ՝ {pinnedContext.programVersion}</div>
          </div>
        </aside>

        {/* Pane 2: Middle Chat Pane */}
        <section className="w-96 bg-white border-r border-gray-200 flex flex-col shrink-0">
          {/* Chat Header */}
          <div className="p-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-gray-800">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              TeachFlow Chat
            </div>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 p-3 overflow-y-auto space-y-3 text-xs">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2.5 shadow-2xs leading-relaxed whitespace-pre-wrap ${
                    m.sender === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none'
                      : 'bg-gray-100 text-gray-900 border border-gray-200/80 rounded-bl-none'
                  }`}
                >
                  {m.text}
                </div>

                {m.pendingIntent && !m.pendingIntent.resolved && (
                  <div className="max-w-[90%] mt-2 p-2.5 bg-white border border-indigo-200 rounded-lg space-y-2">
                    {m.pendingIntent.matchedSources.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.pendingIntent.matchedSources.map((s) => (
                          <span
                            key={s.id}
                            className="px-2 py-1 bg-indigo-50 border border-indigo-200 rounded-full text-[10px] font-medium text-indigo-800"
                            title={`${s.role} · v${s.version}`}
                          >
                            {s.title} · v{s.version}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.pendingIntent.intent === 'generate_thematic_plan' && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-gray-700">
                          Ժամաքանակը վերցվում է առարկայական ծրագրից — լռելյայն արժեքներ չկան:
                        </p>
                        <div className="grid grid-cols-3 gap-1.5">
                          <input
                            type="number"
                            min={1}
                            value={planParams.weeklyHours}
                            onChange={(e) => setPlanParams((p) => ({ ...p, weeklyHours: e.target.value }))}
                            placeholder="Շաբ. ժամ *"
                            className="p-1.5 bg-gray-50 border border-gray-300 rounded-lg text-[11px] focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                          <input
                            type="number"
                            min={1}
                            value={planParams.totalAnnualHours}
                            onChange={(e) => setPlanParams((p) => ({ ...p, totalAnnualHours: e.target.value }))}
                            placeholder="Տարեկան ժամ *"
                            className="p-1.5 bg-gray-50 border border-gray-300 rounded-lg text-[11px] focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                          <input
                            type="text"
                            value={planParams.teacherName}
                            onChange={(e) => setPlanParams((p) => ({ ...p, teacherName: e.target.value }))}
                            placeholder="Ուսուցիչ *"
                            className="p-1.5 bg-gray-50 border border-gray-300 rounded-lg text-[11px] focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleConfirmIntent(m.id, m.pendingIntent!)}
                        disabled={m.pendingIntent.intent === 'generate_thematic_plan' && !planParamsReady}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-[11px] font-semibold"
                      >
                        {t.common.confirm}
                      </button>
                      <button
                        onClick={() => handleCancelIntent(m.id)}
                        className="px-3 py-1.5 border border-gray-300 hover:bg-gray-50 rounded-lg text-[11px] font-medium text-gray-700"
                      >
                        {t.common.cancel}
                      </button>
                    </div>
                  </div>
                )}

                <span className="text-[10px] text-gray-700 mt-1 px-1">{m.timestamp}</span>
              </div>
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-700 italic px-2">
                <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
                TeachFlow-ը գեներացնում է փաստաթուղթը...
              </div>
            )}
          </div>

          {/* Quick Prompts */}
          <div className="p-2 border-t border-gray-100 bg-gray-50/50 flex flex-wrap gap-1.5 text-[11px]">
            <button
              onClick={() => handleSendMessage('Ստեղծել Տիգրան Մեծի թեմատիկ պլանը')}
              className="px-2 py-1 bg-white hover:bg-indigo-50 border border-gray-200 hover:border-indigo-200 rounded text-gray-700 hover:text-indigo-700 transition-colors"
            >
              + Թեմատիկ պլան
            </button>
            <button
              onClick={() => handleSendMessage('Գեներացնել դասի պլան')}
              className="px-2 py-1 bg-white hover:bg-emerald-50 border border-gray-200 hover:border-emerald-200 rounded text-gray-700 hover:text-emerald-700 transition-colors"
            >
              + Դասի պլան (45ր)
            </button>
            <button
              onClick={() => handleSendMessage('Բեռնել հաշվետվությունը')}
              className="px-2 py-1 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded text-gray-700 hover:text-blue-700 transition-colors"
            >
              + Հաշվետվություն
            </button>
          </div>

          {/* Chat Input */}
          <div className="p-3 border-t border-gray-200 bg-white">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Հրահանգեք TeachFlow-ին..."
                className="flex-1 px-3 py-2 text-xs bg-gray-50 border border-gray-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
              <button
                type="submit"
                disabled={isLoading || !inputMessage.trim()}
                className="p-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-colors shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </section>

        {/* Pane 3: Right Canvas Artifact View */}
        <main className="flex-1 bg-white flex flex-col overflow-hidden">
          {/* Canvas Top Bar */}
          <div className="p-3 border-b border-gray-200 bg-gray-50/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                {t.workspace.activeArtifact}:
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                {activeArtifactType === 'thematic_plan' && 'Թեմատիկ պլան (Thematic Plan)'}
                {activeArtifactType === 'lesson_plan' && 'Դասի պլան (Lesson Plan)'}
                {activeArtifactType === 'report' && 'Էլեկտրոնային հաշվետվություն (Report)'}
                {activeArtifactType === 'empty' && 'Դատարկ'}
              </span>
            </div>

            {/* Canvas Actions */}
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg font-medium text-gray-700 transition-colors shadow-2xs"
              >
                <Download className="w-3.5 h-3.5 text-gray-600" />
                {t.common.exportCsv}
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg font-medium text-gray-700 transition-colors shadow-2xs"
              >
                <Printer className="w-3.5 h-3.5 text-gray-600" />
                {t.common.print}
              </button>
            </div>
          </div>

          {/* Canvas Content Area */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeArtifactType === 'thematic_plan' && activeThematicPlan && (
              <div className="max-w-4xl mx-auto space-y-6">
                {/* Plan Metadata Card */}
                <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">{activeThematicPlan.title}</h2>
                      <p className="text-xs text-gray-700">
                        {activeThematicPlan.schoolName} | Ուսուցիչ՝ {activeThematicPlan.teacherName}
                      </p>
                    </div>
                    <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full font-semibold text-xs flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" />
                      Հաստատված է
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-4 mt-4 text-xs">
                    <div className="p-3 bg-gray-50 rounded-lg border border-gray-200/80">
                      <span className="text-gray-700 block">Տարեկան պլանավորված</span>
                      <span className="text-base font-bold text-gray-900">{activeThematicPlan.totalAnnualHours} ժամ</span>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg border border-gray-200/80">
                      <span className="text-gray-700 block">Ծրագրային պահանջ</span>
                      <span className="text-base font-bold text-indigo-700">{activeThematicPlan.programTargetHours} ժամ</span>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg border border-gray-200/80">
                      <span className="text-gray-700 block">Շաբաթական</span>
                      <span className="text-base font-bold text-gray-900">{activeThematicPlan.weeklyHours} ժամ</span>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg border border-gray-200/80">
                      <span className="text-gray-700 block">Ծածկված վերջնարդյունքներ</span>
                      <span className="text-base font-bold text-emerald-700">4 / 4 (100%)</span>
                    </div>
                  </div>
                </div>

                {/* Thematic Table */}
                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs">
                  <div className="p-3 bg-gray-50 border-b border-gray-200 font-bold text-xs text-gray-800">
                    Ուսումնական թեմաների բաշխում և կատարողական
                  </div>
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-gray-50 text-gray-700 font-semibold border-b border-gray-200">
                      <tr>
                        <th className="p-3 w-16">Շաբաթ</th>
                        <th className="p-3">Թեմա</th>
                        <th className="p-3 w-28">Վերջնարդյունք</th>
                        <th className="p-3 w-16">Ժամ</th>
                        <th className="p-3 w-24">Ստուգում</th>
                        <th className="p-3 w-24">Կարգավիճակ</th>
                        <th className="p-3 w-28 text-right">Գործողություն</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {activeThematicPlan.rows.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50/80 transition-colors">
                          <td className="p-3 font-semibold text-gray-700">#{row.weekNumber}</td>
                          <td className="p-3 font-medium text-gray-900">{row.topic}</td>
                          <td className="p-3">
                            {row.outcomeCodes.map((c) => (
                              <span key={c} className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono text-[10px] mr-1">
                                {c}
                              </span>
                            ))}
                          </td>
                          <td className="p-3 font-semibold text-gray-800">{row.plannedHours} ժ</td>
                          <td className="p-3">
                            {row.hasAssessment ? (
                              <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[10px] font-semibold">
                                {row.assessmentType === 'summative' ? 'Ամփոփիչ' : 'Ձևավորող'}
                              </span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="p-3">
                            {row.taught ? (
                              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-semibold rounded text-[10px]">
                                Անցած ({row.actualHours}ժ)
                              </span>
                            ) : (
                              <span className="text-gray-700 text-[10px]">Նախատեսված</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <button
                              onClick={async () => {
                                const res = await fetch('/api/lesson-plans/generate', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    thematicPlanId: activeThematicPlan.id,
                                    rowId: row.id,
                                  }),
                                });
                                const data = await res.json();
                                if (data.lessonPlan) {
                                  setActiveLessonPlan(data.lessonPlan);
                                  setActiveArtifactType('lesson_plan');
                                }
                              }}
                              className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded text-[11px] transition-colors"
                            >
                              Դասի պլան
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeArtifactType === 'lesson_plan' && activeLessonPlan && (
              <div className="max-w-3xl mx-auto bg-white border border-gray-200 rounded-xl p-6 shadow-xs space-y-6">
                {/* Header */}
                <div className="border-b border-gray-200 pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full">
                        Դասի պլան ({activeLessonPlan.durationMinutes} րոպե)
                      </span>
                      <Badge
                        variant={
                          activeLessonPlan.trace.status === 'PASS'
                            ? 'pass'
                            : activeLessonPlan.trace.status === 'WARN'
                            ? 'warn'
                            : 'fail'
                        }
                        size="sm"
                      >
                        {activeLessonPlan.trace.status}
                      </Badge>
                    </div>
                    <button
                      onClick={() => setActiveArtifactType('thematic_plan')}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      ← Վերադառնալ թեմատիկ պլանին
                    </button>
                  </div>
                  <h2 className="text-xl font-bold text-gray-900 mt-2">{activeLessonPlan.topic}</h2>
                  <p className="text-xs text-gray-700 mt-1">
                    Առարկա՝ {activeLessonPlan.subject} | Դասարան՝ {activeLessonPlan.grade}-րդ | Տևողություն՝ {activeLessonPlan.durationMinutes} րոպե
                  </p>
                </div>

                {/* Objectives */}
                <div>
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider mb-2">
                    {t.lessonPlan.objectives}
                  </h3>
                  <ul className="list-disc list-inside text-xs space-y-1 text-gray-700 bg-gray-50 p-3 rounded-lg border border-gray-200">
                    {activeLessonPlan.objectives.map((obj, i) => (
                      <li key={i}>{obj}</li>
                    ))}
                  </ul>
                </div>

                {/* Stages */}
                <div>
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider mb-2">
                    {t.lessonPlan.stages}
                  </h3>
                  <div className="space-y-3">
                    {activeLessonPlan.stages.map((stage, i) => (
                      <div key={i} className="p-3.5 border border-gray-200 rounded-lg bg-white space-y-1.5 shadow-2xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-indigo-900">{stage.title}</span>
                          <span className="text-[11px] font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                            {stage.durationMinutes} րոպե
                          </span>
                        </div>
                        <p className="text-xs text-gray-800">
                          <span className="font-medium text-gray-600">Ուսուցչի գործունեություն:</span> {stage.teacherActivity}
                        </p>
                        <p className="text-xs text-gray-800">
                          <span className="font-medium text-gray-600">Աշակերտի գործունեություն:</span> {stage.studentActivity}
                        </p>
                        <p className="text-xs text-indigo-700">
                          <span className="font-medium">Ձևավորող գնահատում:</span> {stage.formativeCheck}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* FACT Textbook Citations */}
                <div>
                  <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider mb-2">
                    {t.lessonPlan.citations}
                  </h3>
                  <div className="space-y-2">
                    {activeLessonPlan.factCitations.map((cit, i) => {
                      const citationChecks = activeLessonPlan.trace.checks.filter((c) =>
                        c.label.includes(cit.chunkId)
                      );
                      const failed = citationChecks.some((c) => c.result === 'fail');
                      return (
                        <div
                          key={i}
                          className={`p-3 rounded-lg text-xs space-y-1 border ${
                            failed ? 'bg-rose-50/60 border-rose-200' : 'bg-amber-50/60 border-amber-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`font-semibold block ${failed ? 'text-rose-900' : 'text-amber-900'}`}>
                              {cit.sourceTitle}
                            </span>
                            {failed && (
                              <Badge variant="fail" size="sm">
                                {t.common.fail}
                              </Badge>
                            )}
                          </div>
                          <p className="italic text-gray-800">«{cit.quote}»</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Homework */}
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs">
                  <span className="font-bold text-gray-800 block mb-1">{t.lessonPlan.homework}:</span>
                  <p className="text-gray-700">{activeLessonPlan.homework}</p>
                </div>
              </div>
            )}

            {activeArtifactType === 'report' && activeReport && (
              <div className="max-w-3xl mx-auto bg-white border border-gray-200 rounded-xl p-6 shadow-xs space-y-6">
                <div className="border-b border-gray-200 pb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">{activeReport.title}</h2>
                    <p className="text-xs text-gray-700">
                      {activeReport.schoolName} | Հեղինակ՝ {activeReport.authorName} ({activeReport.academicYear ?? 'n/a'})
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full font-semibold text-xs">
                    {activeReport.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <span className="text-gray-700 block">Պլանավորված ժամեր</span>
                    <span className="text-base font-bold text-gray-900">{activeReport.data.plannedHours != null ? `${activeReport.data.plannedHours} ժամ` : 'n/a'}</span>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <span className="text-gray-700 block">Փաստացի անցած</span>
                    <span className="text-base font-bold text-gray-900">{activeReport.data.actualHours != null ? `${activeReport.data.actualHours} ժամ` : 'n/a'}</span>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <span className="text-gray-700 block">Կատարողական (%)</span>
                    <span className="text-base font-bold text-emerald-700">{activeReport.data.completionPercentage != null ? `${activeReport.data.completionPercentage}%` : 'n/a'}</span>
                  </div>
                </div>

                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-xs space-y-2">
                  <span className="font-bold text-gray-800">Ուսուցչի մեկնաբանություն.</span>
                  <p className="text-gray-700 leading-relaxed">
                    {activeReport.data.teacherReflection || 'n/a'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
