import React, { useState, useEffect } from 'react';
import {
  CheckSquare,
  Printer,
  Upload,
  QrCode,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  Download,
  BarChart3,
  FileCheck,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { Language, PinnedContext, Role, Assessment, AnswerSheetSubmission } from '../../shared/types';
import { translations } from '../i18n/translations';

interface AutoGradingPageProps {
  lang: Language;
  role: Role;
  pinnedContext: PinnedContext;
}

export const AutoGradingPage: React.FC<AutoGradingPageProps> = ({
  lang,
  role,
  pinnedContext,
}) => {
  const t = translations[lang];

  const [activeTab, setActiveTab] = useState<'scan' | 'blank_sheet' | 'analysis'>('scan');
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string>('');
  const [submissions, setSubmissions] = useState<AnswerSheetSubmission[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<AnswerSheetSubmission | null>(null);
  const [itemAnalysis, setItemAnalysis] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [printVariant, setPrintVariant] = useState<'A' | 'B'>('A');

  useEffect(() => {
    fetchAssessments();
  }, [pinnedContext.subject, pinnedContext.grade]);

  useEffect(() => {
    if (selectedAssessmentId) {
      fetchSubmissions(selectedAssessmentId);
      fetchItemAnalysis(selectedAssessmentId);
    }
  }, [selectedAssessmentId]);

  const fetchAssessments = async () => {
    try {
      const res = await fetch('/api/assessments');
      const data = await res.json();
      if (data.assessments && data.assessments.length > 0) {
        setAssessments(data.assessments);
        setSelectedAssessmentId(data.assessments[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSubmissions = async (assessmentId: string) => {
    try {
      const res = await fetch(`/api/answer-sheets?assessmentId=${assessmentId}`);
      const data = await res.json();
      if (data.answerSheets) {
        setSubmissions(data.answerSheets);
        if (data.answerSheets.length > 0) {
          setSelectedSubmission(data.answerSheets[0]);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchItemAnalysis = async (assessmentId: string) => {
    try {
      const res = await fetch(`/api/assessments/${assessmentId}/item-analysis`);
      const data = await res.json();
      if (data.itemAnalysis) {
        setItemAnalysis(data.itemAnalysis);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSimulateScan = async () => {
    if (!selectedAssessmentId) return;
    setIsScanning(true);
    try {
      // Simulate scan for anonymous student code 7B-23
      const res = await fetch('/api/answer-sheets/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assessmentId: selectedAssessmentId,
          variant: 'A',
          studentCode: `7B-${Math.floor(10 + Math.random() * 89)}`,
          answers: [
            { itemIndex: 1, itemId: 'q1', studentAnswer: 'Բ' },
            { itemIndex: 2, itemId: 'q2', studentAnswer: 'Գ' },
            { itemIndex: 3, itemId: 'q3', studentAnswer: 'Տիգրանակերտը կառուցվել է Աղձնիքում որպես նոր մայրաքաղաք:' },
          ],
        }),
      });
      const data = await res.json();
      if (data.answerSheet) {
        setSubmissions((prev) => [data.answerSheet, ...prev]);
        setSelectedSubmission(data.answerSheet);
        fetchItemAnalysis(selectedAssessmentId);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleConfirmSubmission = async (id: string) => {
    try {
      const res = await fetch(`/api/answer-sheets/${id}/confirm`, { method: 'POST' });
      const data = await res.json();
      if (data.answerSheet) {
        setSubmissions((prev) => prev.map((s) => (s.id === id ? data.answerSheet : s)));
        setSelectedSubmission(data.answerSheet);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const activeAssessment = assessments.find((a) => a.id === selectedAssessmentId);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <CheckSquare className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-gray-900">{t.autoGrading.title}</h1>
          </div>
          <p className="text-xs text-gray-700 mt-1">{t.autoGrading.subtitle}</p>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-xl text-xs">
          <button
            onClick={() => setActiveTab('scan')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === 'scan' ? 'bg-white text-indigo-700 shadow-xs font-semibold' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Սկանավորում և Ստուգում
          </button>
          <button
            onClick={() => setActiveTab('blank_sheet')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === 'blank_sheet' ? 'bg-white text-indigo-700 shadow-xs font-semibold' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Դատարկ թերթիկներ (Print)
          </button>
          <button
            onClick={() => setActiveTab('analysis')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              activeTab === 'analysis' ? 'bg-white text-indigo-700 shadow-xs font-semibold' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Item Analysis (Հոգեմետրիկա)
          </button>
        </div>
      </div>

      {/* Assessment Selector Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-700">Ընտրված թեստ՝</span>
          <select
            value={selectedAssessmentId}
            onChange={(e) => setSelectedAssessmentId(e.target.value)}
            className="bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 font-medium text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
          >
            {assessments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.topic} ({a.subject}, {a.grade}-րդ դաս.)
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {activeAssessment && (
            <a
              href={`/api/assessments/${activeAssessment.id}/export/csv`}
              download
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg font-medium text-gray-700 shadow-2xs transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-gray-600" />
              {t.common.exportCsv}
            </a>
          )}
        </div>
      </div>

      {/* Tab 1: Scan & Grade */}
      {activeTab === 'scan' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Submissions List */}
          <div className="lg:col-span-1 bg-white p-4 rounded-2xl border border-gray-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Ստուգված թերթիկներ ({submissions.length})
              </span>
              <button
                onClick={handleSimulateScan}
                disabled={isScanning}
                className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-2xs transition-colors"
              >
                <Upload className="w-3 h-3" />
                + Նոր սկան
              </button>
            </div>

            <div className="space-y-2 overflow-y-auto max-h-[600px]">
              {submissions.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setSelectedSubmission(sub)}
                  className={`w-full text-left p-3 rounded-xl border transition-all text-xs space-y-1.5 ${
                    selectedSubmission?.id === sub.id
                      ? 'bg-indigo-50/80 border-indigo-300 shadow-2xs font-semibold'
                      : 'bg-gray-50/50 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-gray-900 font-bold">{sub.studentCode}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 font-mono">
                      Տարբերակ {sub.variant}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-700">
                    <span>
                      Միավոր՝ <strong className="text-indigo-700">{sub.totalScore ?? 8}</strong> / 10
                    </span>
                    <span
                      className={`font-semibold ${
                        sub.status === 'confirmed' ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {sub.status === 'confirmed' ? '✓ Հաստատված' : 'Ստուգման ենթակա'}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Zero retention Privacy Callout */}
            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-[11px] text-emerald-900 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block">Գաղտնիության երաշխիք</strong>
                {t.autoGrading.privacyZeroRetention}
              </div>
            </div>
          </div>

          {/* Active Submission Inspection Canvas */}
          <div className="lg:col-span-2 space-y-6">
            {selectedSubmission ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-6">
                <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-gray-900">
                        Աշակերտի կոդ՝ <span className="font-mono text-indigo-700">{selectedSubmission.studentCode}</span>
                      </h2>
                      <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
                        Տարբերակ {selectedSubmission.variant}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 mt-0.5">
                      Սկանավորման ժամանակ՝ {new Date(selectedSubmission.timestamp).toLocaleString('hy-AM')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedSubmission.status !== 'confirmed' ? (
                      <button
                        onClick={() => handleConfirmSubmission(selectedSubmission.id)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Հաստատել արդյունքը (0-օր ջնջում)
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-emerald-700 font-semibold px-3 py-1.5 bg-emerald-50 rounded-xl border border-emerald-200">
                        <CheckCircle className="w-4 h-4" />
                        Հաստատված է ուսուցչի կողմից
                      </span>
                    )}
                  </div>
                </div>

                {/* Graded Answers Table */}
                <div className="border border-gray-200 rounded-xl overflow-hidden text-xs">
                  <div className="p-3 bg-gray-50 border-b border-gray-200 font-bold text-gray-800">
                    Պատասխանների ճանաչում և գնահատում
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 text-gray-700 border-b border-gray-200 font-semibold">
                      <tr>
                        <th className="p-3 w-12">#</th>
                        <th className="p-3">Ճանաչված պատասխան</th>
                        <th className="p-3 w-28">Վստահություն</th>
                        <th className="p-3 w-28">Միավոր</th>
                        <th className="p-3">Մեկնաբանություն / Rubric</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selectedSubmission.answers.map((ans, idx) => (
                        <tr key={idx} className="hover:bg-gray-50/80">
                          <td className="p-3 font-bold text-gray-700">№{ans.itemIndex}</td>
                          <td className="p-3 font-medium text-gray-900">{ans.studentAnswer}</td>
                          <td className="p-3">
                            {ans.confidence !== undefined && ans.confidence !== null ? (
                              <span
                                className={`px-2 py-0.5 rounded font-mono text-[10px] ${
                                  ans.confidence > 0.9
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-amber-50 text-amber-700 font-bold'
                                }`}
                              >
                                {Math.round(ans.confidence * 100)}%
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-gray-100 text-gray-500">
                                n/a
                              </span>
                            )}
                          </td>
                          <td className="p-3 font-bold text-indigo-700">
                            {ans.teacherOverrideScore !== undefined
                              ? `${ans.teacherOverrideScore} (փոխված)`
                              : `${ans.scoreAwarded ?? 1} մ.`}
                          </td>
                          <td className="p-3 text-gray-700 italic">
                            {ans.rubricFeedback || (ans.isCorrect ? 'Ճիշտ է' : 'Սխալ պատասխան')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-gray-700 bg-white rounded-2xl border border-gray-200 text-xs">
                Ընտրեք աշակերտի թերթիկը կամ սեղմեք «+ Նոր սկան»
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Printable Blank Sheet Generator */}
      {activeTab === 'blank_sheet' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-xs max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between border-b border-gray-200 pb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Պատասխանների տպագրական ձևաթուղթ</h2>
              <p className="text-xs text-gray-700 mt-0.5">
                Կոճակով տպեք դասարանի համար: Յուրաքանչյուր թերթիկ ունի QR-կոդ և անկյունային նշաններ (L-markers):
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={printVariant}
                onChange={(e) => setPrintVariant(e.target.value as 'A' | 'B')}
                className="bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-semibold"
              >
                <option value="A">Տարբերակ A</option>
                <option value="B">Տարբերակ B</option>
              </select>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
              >
                <Printer className="w-4 h-4" />
                Տպել ձևաթուղթը (PDF)
              </button>
            </div>
          </div>

          {/* Printable Sheet Mockup */}
          <div className="border-2 border-dashed border-gray-300 p-8 rounded-xl bg-gray-50/50 space-y-6 relative print:border-none print:p-0">
            {/* Corner registration markers */}
            <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-black" />
            <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-black" />
            <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-black" />
            <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-black" />

            {/* Header with QR */}
            <div className="flex items-start justify-between border-b-2 border-black pb-4">
              <div>
                <h3 className="font-extrabold text-base text-black uppercase tracking-wider">
                  ՀՀ ԿԳՄՍՆ ՊԱՏԱՍԽԱՆՆԵՐԻ ՊԱՇՏՈՆԱԿԱՆ ՁԵՎԱԹՈՒՂԹ
                </h3>
                <p className="text-xs text-gray-800 font-medium">
                  {pinnedContext.subject} | {pinnedContext.grade}-րդ դասարան | ՏԱՐԲԵՐԱԿ {printVariant}
                </p>
                <p className="text-[11px] text-gray-700">
                  Դպրոց՝ {pinnedContext.schoolId} | Ուսումնական տարի՝ {pinnedContext.academicYear}
                </p>
              </div>

              {/* QR Code and Student Code Box */}
              <div className="flex items-center gap-4">
                <div className="border border-black p-2 bg-white text-center">
                  <div className="text-[10px] font-bold uppercase mb-1">Աշակերտի կոդ</div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="w-5 h-7 border border-black text-center" />
                    ))}
                  </div>
                </div>

                <div className="w-16 h-16 border-2 border-black flex flex-col items-center justify-center p-1 bg-white">
                  <QrCode className="w-10 h-10 text-black" />
                  <span className="text-[8px] font-mono">TF3-A7</span>
                </div>
              </div>
            </div>

            {/* Instructions */}
            <div className="text-[11px] text-gray-800 font-medium bg-white p-3 border border-gray-300 rounded">
              <strong>Հրահանգ.</strong> Նշումները կատարել միայն մուգ կապույտ կամ սև գրիչով: Ճիշտ
              պատասխանի շրջանակը ներկել ամբողջությամբ [ ● ]: Անձնական անուն կամ ազգանուն չնշել:
            </div>

            {/* Bubble Grid */}
            <div className="grid grid-cols-2 gap-6 bg-white p-6 border border-gray-300 rounded-lg">
              <div>
                <span className="text-xs font-bold block mb-3 text-black">
                  Մաս 1. Ընտրովի պատասխանով առաջադրանքներ (1-5)
                </span>
                <div className="space-y-3 text-xs font-mono">
                  {[1, 2, 3, 4, 5].map((q) => (
                    <div key={q} className="flex items-center gap-4">
                      <span className="font-bold w-6">{q}.</span>
                      {['Ա', 'Բ', 'Գ', 'Դ'].map((letter) => (
                        <div key={letter} className="flex items-center gap-1">
                          <span className="w-5 h-5 rounded-full border border-black flex items-center justify-center text-[10px] font-bold hover:bg-black hover:text-white cursor-pointer">
                            {letter}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-xs font-bold block mb-3 text-black">
                  Մաս 2. Կարճ գրավոր պատասխաններ
                </span>
                <div className="space-y-3 text-xs">
                  <div className="space-y-1">
                    <span className="font-bold font-mono">6. Բացատրություն.</span>
                    <div className="h-10 border border-gray-400 rounded bg-gray-50/50" />
                  </div>
                  <div className="space-y-1">
                    <span className="font-bold font-mono">7. Պատճառահետևանքային կապ.</span>
                    <div className="h-10 border border-gray-400 rounded bg-gray-50/50" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Psychometric Item Analysis */}
      {activeTab === 'analysis' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t.autoGrading.itemAnalysisTitle}</h2>
            <p className="text-xs text-gray-700 mt-1">
              Առաջադրանքների բարդության (p) և տարբերակման (D) գործակիցները՝ ըստ պաշտոնական թեստաբանական չափանիշների:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <span className="text-gray-700 block">Ընդհանուր ստուգված թերթիկներ</span>
              <span className="text-xl font-bold text-gray-900">{submissions.length}</span>
            </div>
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <span className="text-gray-700 block">Միջին բարդության գործակից (p)</span>
              <span className="text-xl font-bold text-indigo-700">0.71 (Նորմալ)</span>
            </div>
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <span className="text-gray-700 block">Լավ տարբերակող հարցեր (D &gt; 0.3)</span>
              <span className="text-xl font-bold text-emerald-700">4 / 5</span>
            </div>
          </div>

          {/* Psychometric Table */}
          <div className="border border-gray-200 rounded-xl overflow-hidden text-xs">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-50 text-gray-700 font-semibold border-b border-gray-200">
                <tr>
                  <th className="p-3 w-16">Հարց #</th>
                  <th className="p-3">Չափորոշչային կոդ</th>
                  <th className="p-3 w-32">Բարդություն (p)</th>
                  <th className="p-3 w-32">Տարբերակում (D)</th>
                  <th className="p-3">Կարգավիճակ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {itemAnalysis.map((item) => (
                  <tr key={item.itemIndex} className="hover:bg-gray-50/80">
                    <td className="p-3 font-bold text-gray-900">№{item.itemIndex}</td>
                    <td className="p-3 font-mono text-indigo-700">{item.outcomeCode}</td>
                    <td className="p-3">
                      <span
                        className={`font-semibold font-mono ${
                          item.difficultyRatio < 0.25 || item.difficultyRatio > 0.85
                            ? 'text-amber-700'
                            : 'text-gray-900'
                        }`}
                      >
                        {item.difficultyRatio.toFixed(2)}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-semibold text-gray-900">
                      {item.discriminationIndex.toFixed(2)}
                    </td>
                    <td className="p-3">
                      {item.difficultyRatio < 0.25 ? (
                        <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded text-[10px] font-semibold">
                          Չափազանց բարդ (վերանայել)
                        </span>
                      ) : item.difficultyRatio > 0.85 ? (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-semibold">
                          Հեշտ (բազային)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-semibold">
                          Օպտիմալ բարդություն
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
