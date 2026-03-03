import { useState, useRef, useEffect } from 'react';
import { 
  FileText, 
  Upload, 
  Download, 
  Copy, 
  Play, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Table as TableIcon,
  Plus,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import Papa from 'papaparse';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Paper } from './types';
import { analyzePapers, analyzePDFBatch } from './services/geminiService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const CSV_HEADERS = [
  "Paper ID",
  "Modeling notation / standard",
  "Architecture modeling language",
  "UML diagram types",
  "Industry domain",
  "Metamodel defined?",
  "Meta-metamodel?",
  "Metamodel level",
  "SDLC phase",
  "Abstraction level",
  "Model usage",
  "Transformation maturity",
  "Transformation engine",
  "Modeling tools",
  "Generated artefacts",
  "DevOps / CI/CD relevance",
  "DevOps / CI/CD aspects"
];

export default function App() {
  const [inputMode, setInputMode] = useState<'text' | 'pdf'>('text');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [results, setResults] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [textInput, setTextInput] = useState('');
  const [apiKey] = useState(process.env.GEMINI_API_KEY || '');
  const [autoDownload, setAutoDownload] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Warn before refresh if processing
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isProcessing) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isProcessing]);

  const handleTextInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextInput(e.target.value);
  };

  const parseTextInput = () => {
    const lines = textInput.split('\n').filter(l => l.trim());
    const newPapers: Paper[] = lines.map((line, index) => {
      const parts = line.split('\t');
      return {
        id: `P${String(papers.length + index + 1).padStart(3, '0')}`,
        title: parts[0] || 'Untitled Paper',
        abstract: parts[1] || 'No abstract provided',
        status: 'queued'
      };
    });
    setPapers([...papers, ...newPapers]);
    setTextInput('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    if (inputMode === 'pdf') {
      const newPapers: Paper[] = Array.from(files).map((file) => ({
        id: file.name,
        title: file.name,
        abstract: 'Full PDF content',
        file,
        status: 'queued'
      }));
      setPapers([...papers, ...newPapers]);
    } else {
      // CSV Upload
      Papa.parse(files[0], {
        header: true,
        complete: (results) => {
          const newPapers: Paper[] = results.data
            .filter((row: any) => row.id || row.title)
            .map((row: any, index: number) => ({
              id: row.id || `CSV${String(papers.length + index + 1).padStart(3, '0')}`,
              title: row.title || 'Untitled',
              abstract: row.abstract || '',
              status: 'queued'
            }));
          setPapers([...papers, ...newPapers]);
        }
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePaper = (id: string) => {
    setPapers(papers.filter(p => p.id !== id));
  };

  const clearAll = () => {
    if (window.confirm('Are you sure you want to clear all data? This will remove all results and the queue.')) {
      setPapers([]);
      setResults([]);
      setProgress(0);
    }
  };

  const startProcessing = async () => {
    if (papers.length === 0) return;

    const queuedPapers = papers.filter(p => p.status === 'queued');
    const missingFiles = inputMode === 'pdf' && queuedPapers.some(p => !p.file);
    
    if (missingFiles) {
      alert('Some papers in the queue are missing their PDF files (likely due to a page refresh). Please re-upload the files to continue.');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    
    let completedCount = 0;
    const batchSize = 1;

    let currentResults = [...results];

    for (let i = 0; i < queuedPapers.length; i += batchSize) {
      const batch = queuedPapers.slice(i, i + batchSize);
      
      setPapers(prev => prev.map(p => 
        batch.some(bp => bp.id === p.id) ? { ...p, status: 'processing' } : p
      ));

      try {
        let resultText = '';
        if (inputMode === 'text') {
          resultText = await analyzePapers(batch, apiKey) || '';
        } else {
          resultText = await analyzePDFBatch(batch, apiKey) || '';
        }

        if (resultText) {
          // The AI returns raw CSV rows. We split by newline in case it returned multiple rows.
          const rows = resultText.trim().split('\n').filter(line => line.trim());
          currentResults = [...currentResults, ...rows];
          setResults(currentResults);
          
          setPapers(prev => prev.map(p => 
            batch.some(bp => bp.id === p.id) ? { ...p, status: 'completed' } : p
          ));
        }

        // Add a small delay between requests to prevent rate limiting
        if (i + batchSize < queuedPapers.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error('Batch processing error:', error);
        setPapers(prev => prev.map(p => 
          batch.some(bp => bp.id === p.id) ? { ...p, status: 'error' } : p
        ));
      }

      completedCount += batch.length;
      setProgress(Math.round((completedCount / queuedPapers.length) * 100));

      // Auto-download if enabled (every 5 papers or at the very end)
      if (autoDownload && (completedCount % 5 === 0 || completedCount === queuedPapers.length)) {
        const headerRow = CSV_HEADERS.map(h => `"${h}"`).join(',');
        const csvContent = [headerRow, ...currentResults].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `slr_backup_batch_${completedCount}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }

    setIsProcessing(false);
  };

  const copyToClipboard = () => {
    const headerRow = CSV_HEADERS.map(h => `"${h}"`).join(',');
    const fullContent = [headerRow, ...results].join('\n');
    navigator.clipboard.writeText(fullContent);
  };

  const downloadCSV = () => {
    const headerRow = CSV_HEADERS.map(h => `"${h}"`).join(',');
    const csvContent = [headerRow, ...results].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'slr_extraction_results.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#F5F5F0]">
      <header className="border-b border-[#141414]/10 bg-white/50 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#141414] rounded-lg flex items-center justify-center text-[#F5F5F0]">
              <TableIcon size={18} />
            </div>
            <h1 className="font-serif italic text-xl font-semibold tracking-tight">MDDOAI Researcher Tool</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 mr-2">
              <span className="text-[10px] font-bold uppercase tracking-tighter opacity-50">Auto-Download</span>
              <button 
                onClick={() => setAutoDownload(!autoDownload)}
                className={cn(
                  "w-8 h-4 rounded-full p-0.5 transition-colors duration-200 ease-in-out relative",
                  autoDownload ? "bg-green-500" : "bg-[#141414]/20"
                )}
              >
                <div className={cn(
                  "w-3 h-3 bg-white rounded-full shadow-sm transform transition-transform duration-200",
                  autoDownload ? "translate-x-4" : "translate-x-0"
                )} />
              </button>
            </div>
            <div className="text-xs font-mono opacity-50 uppercase tracking-widest">SLR Data Extraction</div>
            {isProcessing && (
              <div className="flex items-center gap-2 px-3 py-1 bg-[#141414] text-[#F5F5F0] rounded-full text-xs font-medium animate-pulse">
                <Loader2 size={12} className="animate-spin" />
                Processing...
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-5 space-y-6">
            <section className="bg-white rounded-2xl border border-[#141414]/5 shadow-sm overflow-hidden">
              <div className="flex border-b border-[#141414]/5">
                <button 
                  onClick={() => setInputMode('text')}
                  className={cn(
                    "flex-1 py-4 text-sm font-medium transition-colors",
                    inputMode === 'text' ? "bg-[#141414] text-[#F5F5F0]" : "hover:bg-[#141414]/5"
                  )}
                >
                  Text / CSV Mode
                </button>
                <button 
                  onClick={() => setInputMode('pdf')}
                  className={cn(
                    "flex-1 py-4 text-sm font-medium transition-colors",
                    inputMode === 'pdf' ? "bg-[#141414] text-[#F5F5F0]" : "hover:bg-[#141414]/5"
                  )}
                >
                  PDF Mode
                </button>
              </div>

              <div className="p-6 space-y-6">
                {inputMode === 'text' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider opacity-50">Paste Papers (Title [TAB] Abstract)</label>
                      <textarea 
                        value={textInput}
                        onChange={handleTextInputChange}
                        placeholder="Paper Title 1	Abstract content here..."
                        className="w-full h-32 p-4 bg-[#F5F5F0] border-none rounded-xl text-sm focus:ring-2 focus:ring-[#141414] transition-all resize-none font-mono"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={parseTextInput}
                        disabled={!textInput.trim()}
                        className="flex-1 bg-[#141414] text-[#F5F5F0] py-3 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-30 flex items-center justify-center gap-2"
                      >
                        <Plus size={16} /> Add to Queue
                      </button>
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 border border-[#141414]/10 rounded-xl hover:bg-[#141414]/5 transition-colors"
                        title="Upload CSV"
                      >
                        <Upload size={18} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-[#141414]/10 rounded-2xl p-10 flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-[#141414]/5 transition-colors group"
                    >
                      <div className="w-12 h-12 rounded-full bg-[#141414]/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Upload size={24} />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium">Click to upload PDF papers</p>
                        <p className="text-xs opacity-50 mt-1">Select multiple files at once</p>
                      </div>
                    </div>
                  </div>
                )}

                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  className="hidden" 
                  multiple={inputMode === 'pdf'}
                  accept={inputMode === 'pdf' ? '.pdf' : '.csv'}
                />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider opacity-50">Queue ({papers.length})</h3>
                    {papers.length > 0 && (
                      <button onClick={clearAll} className="text-[10px] uppercase font-bold text-red-500 hover:underline">Clear All</button>
                    )}
                  </div>
                  
                  <div className="max-h-[400px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    <AnimatePresence initial={false}>
                      {papers.map((paper) => (
                        <motion.div 
                          key={paper.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          className="group flex items-center gap-3 p-3 bg-[#F5F5F0] rounded-xl border border-[#141414]/5"
                        >
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                            paper.status === 'completed' ? "bg-green-100 text-green-600" :
                            paper.status === 'processing' ? "bg-blue-100 text-blue-600" :
                            paper.status === 'error' ? "bg-red-100 text-red-600" :
                            "bg-white text-[#141414]/40"
                          )}>
                            {paper.status === 'completed' ? <CheckCircle2 size={16} /> :
                             paper.status === 'processing' ? <Loader2 size={16} className="animate-spin" /> :
                             paper.status === 'error' ? <AlertCircle size={16} /> :
                             <FileText size={16} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{paper.title}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-[10px] opacity-40 font-mono">{paper.id}</p>
                              {inputMode === 'pdf' && !paper.file && paper.status === 'queued' && (
                                <span className="text-[9px] font-bold text-orange-500 uppercase bg-orange-50 px-1 rounded">File missing - Re-upload</span>
                              )}
                            </div>
                          </div>
                          <button 
                            onClick={() => removePaper(paper.id)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 hover:text-red-500 rounded-md transition-all"
                          >
                            <X size={14} />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {papers.length === 0 && (
                      <div className="py-10 text-center opacity-30 italic text-sm">
                        No papers in queue
                      </div>
                    )}
                  </div>
                </div>

                {papers.length > 0 && (
                  <button 
                    onClick={startProcessing}
                    disabled={isProcessing}
                    className="w-full bg-[#141414] text-[#F5F5F0] py-4 rounded-xl font-bold uppercase tracking-widest text-xs hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-3"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Processing {Math.round(progress)}%
                      </>
                    ) : (
                      <>
                        <Play size={16} fill="currentColor" />
                        Start Extraction
                      </>
                    )}
                  </button>
                )}
              </div>
            </section>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <section className="bg-white rounded-2xl border border-[#141414]/5 shadow-sm h-full flex flex-col">
              <div className="p-6 border-b border-[#141414]/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#141414]/5 flex items-center justify-center">
                    <TableIcon size={18} />
                  </div>
                  <h2 className="font-serif italic text-lg font-semibold">Extraction Results</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={copyToClipboard}
                    disabled={results.length === 0}
                    className="p-2 hover:bg-[#141414]/5 rounded-lg transition-colors disabled:opacity-30"
                    title="Copy Markdown"
                  >
                    <Copy size={18} />
                  </button>
                  <button 
                    onClick={downloadCSV}
                    disabled={results.length === 0}
                    className="p-2 hover:bg-[#141414]/5 rounded-lg transition-colors disabled:opacity-30"
                    title="Download CSV"
                  >
                    <Download size={18} />
                  </button>
                </div>
              </div>

              <div className="flex-1 p-6 overflow-auto custom-scrollbar">
                {results.length > 0 ? (
                  <div className="space-y-4">
                    <div className="bg-[#F5F5F0] p-4 rounded-xl border border-[#141414]/5 overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[#141414]/10">
                            {CSV_HEADERS.map((header, i) => (
                              <th key={i} className="p-2 font-bold whitespace-nowrap">{header}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {results.map((row, i) => {
                            // Simple CSV row parser (handles quoted values with commas)
                            const cells = Papa.parse(row).data[0] as string[];
                            return (
                              <tr key={i} className="border-b border-[#141414]/5 hover:bg-[#141414]/5 transition-colors">
                                {cells.map((cell, j) => (
                                  <td key={j} className="p-2 whitespace-nowrap max-w-[300px] truncate" title={cell}>{cell}</td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="bg-[#141414] p-4 rounded-xl text-[#F5F5F0] font-mono text-[10px] overflow-x-auto">
                      <div className="opacity-50 mb-2 uppercase tracking-widest font-bold">Raw CSV Output</div>
                      <pre>{[CSV_HEADERS.map(h => `"${h}"`).join(','), ...results].join('\n')}</pre>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center opacity-20 py-20">
                    <TableIcon size={48} strokeWidth={1} />
                    <p className="mt-4 font-serif italic">Results will appear here after processing</p>
                  </div>
                )}
              </div>

              {isProcessing && (
                <div className="p-4 bg-[#141414] text-[#F5F5F0]">
                  <div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-widest mb-2">
                    <span>Overall Progress</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-white"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(20, 20, 20, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(20, 20, 20, 0.2);
        }
      `}</style>
    </div>
  );
}
