/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect } from 'react';
import { GeneratedImage, ComplexityLevel, VisualStyle, Language, SearchResultItem } from './types';
import { 
  researchTopicForPrompt, 
  generateInfographicImage, 
  editInfographicImage,
} from './services/geminiService';
import Infographic from './components/Infographic';
import Loading from './components/Loading';
import IntroScreen from './components/IntroScreen';
import SearchResults from './components/SearchResults';
import { Search, AlertCircle, History, GraduationCap, Palette, Microscope, Atom, Compass, Globe, Sun, Moon, Key, CreditCard, ExternalLink, DollarSign, Trash2, LogIn, LogOut, Cloud } from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  auth, 
  signInWithGoogle, 
  logOutUser, 
  saveInfographicToDb, 
  loadUserInfographics, 
  deleteInfographicFromDb,
  testConnection 
} from './services/firebaseService';

const App: React.FC = () => {
  const [showIntro, setShowIntro] = useState(true);
  const [topic, setTopic] = useState('');
  // Aspect ratio is now hardcoded to 16:9 in the service calls
  const [complexityLevel, setComplexityLevel] = useState<ComplexityLevel>('High School');
  const [visualStyle, setVisualStyle] = useState<VisualStyle>('Default');
  const [language, setLanguage] = useState<Language>('English');
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [loadingStep, setLoadingStep] = useState<number>(0);
  const [loadingFacts, setLoadingFacts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const [imageHistory, setImageHistory] = useState<GeneratedImage[]>([]);
  const [currentSearchResults, setCurrentSearchResults] = useState<SearchResultItem[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(true);

  // API Key State
  const [hasApiKey, setHasApiKey] = useState(false);
  const [checkingKey, setCheckingKey] = useState(true);

  // Firebase Auth State
  const [user, setUser] = useState<User | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Check for API Key & Register Auth State Listener
  useEffect(() => {
    testConnection(); // Verify server is reachable on boot

    const checkKey = async () => {
      try {
        if (window.aistudio && window.aistudio.hasSelectedApiKey) {
          const hasKey = await window.aistudio.hasSelectedApiKey();
          setHasApiKey(hasKey);
        } else {
          // Development environment fallback or if not running in AI Studio context
          setHasApiKey(true);
        }
      } catch (e) {
        console.error("Error checking API key:", e);
      } finally {
        setCheckingKey(false);
      }
    };
    checkKey();

    // Monitor Firebase Authentication state securely
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setLoadingHistory(true);
        try {
          const params = new URLSearchParams(window.location.search);
          const urlTopic = params.get('topic');
          // Only pull user's designs if they aren't loading a direct shared link
          if (!urlTopic) {
            const dbHistory = await loadUserInfographics(currentUser.uid);
            if (dbHistory.length > 0) {
              setImageHistory(dbHistory);
            }
          }
        } catch (err) {
          console.error("Failed to recover user history from cloud database:", err);
        } finally {
          setLoadingHistory(false);
        }
      } else {
        setImageHistory([]);
      }
    });

    return () => unsubscribe();
  }, []);

  // Parse direct share link parameters on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTopic = params.get('topic');
    if (urlTopic && urlTopic.trim() && !isLoading && imageHistory.length === 0) {
      setTopic(urlTopic);
      setShowIntro(false);
      
      const checkAndRun = setInterval(() => {
        if (!checkingKey) {
          clearInterval(checkAndRun);
          
          const urlLevel = params.get('level') as ComplexityLevel;
          const urlStyle = params.get('style') as VisualStyle;
          const urlLang = params.get('language') as Language;

          if (urlLevel) setComplexityLevel(urlLevel);
          if (urlStyle) setVisualStyle(urlStyle);
          if (urlLang) setLanguage(urlLang);

          const performSearch = async () => {
            setIsLoading(true);
            setError(null);
            setLoadingStep(1);
            setLoadingFacts([]);
            setCurrentSearchResults([]);
            setLoadingMessage(`Researching shared topic...`);
         
            try {
              const activeLevel = urlLevel || complexityLevel;
              const activeStyle = urlStyle || visualStyle;
              const activeLang = urlLang || language;
              const researchResult = await researchTopicForPrompt(urlTopic, activeLevel, activeStyle, activeLang);
              
              setLoadingFacts(researchResult.facts);
              setCurrentSearchResults(researchResult.searchResults);
              
              setLoadingStep(2);
              setLoadingMessage(`Designing Infographic...`);
              
              let base64Data = await generateInfographicImage(researchResult.imagePrompt);
              
              const newImage: GeneratedImage = {
                id: Date.now().toString(),
                data: base64Data,
                prompt: urlTopic,
                timestamp: Date.now(),
                level: activeLevel,
                style: activeStyle,
                language: activeLang,
                imagePrompt: researchResult.imagePrompt,
                originalTopic: urlTopic
              };
         
              setImageHistory([newImage]);
            } catch (err: any) {
              console.error(err);
              if (err.message && (err.message.includes("Requested entity was not found") || err.message.includes("404") || err.message.includes("403"))) {
                  setError("Access denied. The selected API key does not have access to the required models. Please select a project with billing enabled.");
                  setHasApiKey(false);
              } else {
                  setError('The image generation service is temporarily unavailable. Please try again.');
              }
            } finally {
              setIsLoading(false);
              setLoadingStep(0);
            }
          };
          performSearch();
        }
      }, 100);
      return () => clearInterval(checkAndRun);
    }
  }, [checkingKey]);

  const handleSelectKey = async () => {
    if (window.aistudio && window.aistudio.openSelectKey) {
      try {
        await window.aistudio.openSelectKey();
        // Assume success due to race condition logic mentioned in guidelines
        setHasApiKey(true);
        setError(null);
      } catch (e) {
        console.error("Failed to open key selector:", e);
      }
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    if (!topic.trim()) {
        setError("Please enter a topic to visualize.");
        return;
    }

    setIsLoading(true);
    setError(null);
    setLoadingStep(1);
    setLoadingFacts([]);
    setCurrentSearchResults([]);
    setLoadingMessage(`Researching topic...`);

    try {
      // Step 1: Research and Construct Prompt
      const researchResult = await researchTopicForPrompt(topic, complexityLevel, visualStyle, language);
      
      setLoadingFacts(researchResult.facts);
      setCurrentSearchResults(researchResult.searchResults);
      
      setLoadingStep(2);
      setLoadingMessage(`Designing Infographic...`);
      
      // Step 2: Direct Image Generation
      let base64Data = await generateInfographicImage(researchResult.imagePrompt);
      
      const newImage: GeneratedImage = {
        id: Date.now().toString(),
        data: base64Data,
        prompt: topic,
        timestamp: Date.now(),
        level: complexityLevel,
        style: visualStyle,
        language: language,
        imagePrompt: researchResult.imagePrompt,
        originalTopic: topic
      };

      if (user) {
        try {
          await saveInfographicToDb(user.uid, newImage);
        } catch (dbErr) {
          console.error("Failed to automatically upload infographic to cloud history:", dbErr);
        }
      }

      setImageHistory([newImage, ...imageHistory]);
    } catch (err: any) {
      console.error(err);
      // Check for specific billing/key errors
      if (err.message && (err.message.includes("Requested entity was not found") || err.message.includes("404") || err.message.includes("403"))) {
          setError("Access denied. The selected API key does not have access to the required models. Please select a project with billing enabled.");
          setHasApiKey(false); // Force the key selection modal to reappear
      } else {
          setError('The image generation service is temporarily unavailable. Please try again.');
      }
    } finally {
      setIsLoading(false);
      setLoadingStep(0);
    }
  };

  const handleEdit = async (editPrompt: string) => {
    if (imageHistory.length === 0) return;
    const currentImage = imageHistory[0];
    setIsLoading(true);
    setError(null);
    setLoadingStep(2);
    setLoadingMessage(`Processing Modification: "${editPrompt}"...`);

    try {
      const base64Data = await editInfographicImage(currentImage.data, editPrompt);
      const newImage: GeneratedImage = {
        id: Date.now().toString(),
        data: base64Data,
        prompt: editPrompt,
        timestamp: Date.now(),
        level: currentImage.level,
        style: currentImage.style,
        language: currentImage.language,
        imagePrompt: currentImage.imagePrompt,
        originalTopic: currentImage.originalTopic
      };

      if (user) {
        try {
          await saveInfographicToDb(user.uid, newImage);
        } catch (dbErr) {
          console.error("Failed to automatically upload modified design to cloud history:", dbErr);
        }
      }

      setImageHistory([newImage, ...imageHistory]);
    } catch (err: any) {
      console.error(err);
      if (err.message && (err.message.includes("Requested entity was not found") || err.message.includes("404") || err.message.includes("403"))) {
          setError("Access denied. Please select a valid API key with billing enabled.");
          setHasApiKey(false);
      } else {
          setError('Modification failed. Try a different command.');
      }
    } finally {
      setIsLoading(false);
      setLoadingStep(0);
    }
  };

  const handleRegenerate = async () => {
    if (imageHistory.length === 0 || isLoading) return;
    const currentImage = imageHistory[0];
    
    const activeTopic = currentImage.originalTopic || currentImage.prompt || topic;
    const activeLevel = currentImage.level || complexityLevel;
    const activeStyle = currentImage.style || visualStyle;
    const activeLanguage = currentImage.language || language;

    setIsLoading(true);
    setError(null);
    setLoadingStep(1);
    setLoadingFacts([]);
    setCurrentSearchResults([]);
    setLoadingMessage(`Researching topic...`);

    try {
      // Step 1: Research and Construct Prompt
      const researchResult = await researchTopicForPrompt(activeTopic, activeLevel, activeStyle, activeLanguage);
      
      setLoadingFacts(researchResult.facts);
      setCurrentSearchResults(researchResult.searchResults);
      
      setLoadingStep(2);
      setLoadingMessage(`Designing Infographic...`);
      
      // Step 2: Direct Image Generation
      let base64Data = await generateInfographicImage(researchResult.imagePrompt);
      
      const newImage: GeneratedImage = {
        id: Date.now().toString(),
        data: base64Data,
        prompt: activeTopic,
        timestamp: Date.now(),
        level: activeLevel,
        style: activeStyle,
        language: activeLanguage,
        imagePrompt: researchResult.imagePrompt,
        originalTopic: activeTopic
      };

      if (user) {
        try {
          await saveInfographicToDb(user.uid, newImage);
        } catch (dbErr) {
          console.error("Failed to automatically upload regenerated design to cloud history:", dbErr);
        }
      }

      setImageHistory([newImage, ...imageHistory]);
    } catch (err: any) {
      console.error(err);
      if (err.message && (err.message.includes("Requested entity was not found") || err.message.includes("404") || err.message.includes("403"))) {
          setError("Access denied. The selected API key does not have access to the required models. Please select a project with billing enabled.");
          setHasApiKey(false);
      } else {
          setError('Regeneration failed. The image generation service is temporarily unavailable. Please try again.');
      }
    } finally {
      setIsLoading(false);
      setLoadingStep(0);
    }
  };

  const restoreImage = (img: GeneratedImage) => {
     const newHistory = imageHistory.filter(i => i.id !== img.id);
     setImageHistory([img, ...newHistory]);
  };

  const handleDeleteInfographic = async (id: string) => {
    if (user) {
      try {
        await deleteInfographicFromDb(user.uid, id);
      } catch (err) {
        console.error("Failed to remove design from cloud database:", err);
      }
    }
    setImageHistory(prev => prev.filter(item => item.id !== id));
  };

  // Modal for API Key Selection
  const KeySelectionModal = () => (
    <div className="fixed inset-0 z-[200] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
        <div className="bg-white dark:bg-slate-900 border-2 border-amber-500/50 rounded-2xl shadow-2xl max-w-md w-full p-6 md:p-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500"></div>
            
            <div className="flex flex-col items-center text-center space-y-6">
                <div className="relative">
                    <div className="w-20 h-20 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center text-amber-600 dark:text-amber-400 mb-2 border-4 border-white dark:border-slate-900 shadow-lg">
                        <CreditCard className="w-8 h-8" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm border-2 border-white dark:border-slate-900 uppercase tracking-wide">
                        Paid App
                    </div>
                </div>
                
                <div className="space-y-3">
                    <h2 className="text-2xl font-display font-bold text-slate-900 dark:text-white">
                        Paid API Key Required
                    </h2>
                    <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed font-medium">
                        This application uses premium Gemini 3 Pro models which are not available on the free tier.
                    </p>
                    <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
                        You must select a Google Cloud Project with <span className="font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1 py-0.5 rounded">Billing Enabled</span> to proceed.
                    </p>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 w-full text-left">
                    <div className="flex items-start gap-3">
                         <div className="p-1.5 bg-amber-100 dark:bg-amber-900/30 rounded-lg text-amber-600 dark:text-amber-400 shrink-0">
                            <DollarSign className="w-4 h-4" />
                         </div>
                         <div className="space-y-1">
                            <p className="text-xs font-bold text-slate-900 dark:text-slate-200">Billing Required</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Standard API keys will fail. Please ensure you have set up billing in Google AI Studio.
                            </p>
                             <a 
                                href="https://ai.google.dev/gemini-api/docs/billing" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:underline mt-1"
                            >
                                View Billing Documentation <ExternalLink className="w-3 h-3" />
                            </a>
                         </div>
                    </div>
                </div>

                <button 
                    onClick={handleSelectKey}
                    className="w-full py-3.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl font-bold shadow-lg shadow-amber-500/20 transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2"
                >
                    <Key className="w-4 h-4" />
                    <span>Select Paid API Key</span>
                </button>
            </div>
        </div>
    </div>
  );

  return (
    <>
    {/* Block usage if key is missing */}
    {!checkingKey && !hasApiKey && <KeySelectionModal />}

    {showIntro ? (
      <IntroScreen onComplete={() => setShowIntro(false)} />
    ) : (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-200 font-sans selection:bg-cyan-500 selection:text-white pb-20 relative overflow-x-hidden animate-in fade-in duration-1000 transition-colors">
      
      {/* Background Elements */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100 via-slate-50 to-white dark:from-indigo-900 dark:via-slate-950 dark:to-black z-0 transition-colors"></div>
      <div className="fixed inset-0 opacity-5 dark:opacity-20 z-0 pointer-events-none" style={{
          backgroundImage: `radial-gradient(currentColor 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
      }}></div>

      {/* Navbar */}
      <header className="border-b border-slate-200 dark:border-white/10 sticky top-0 z-50 backdrop-blur-md bg-white/70 dark:bg-slate-950/60 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 md:h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 md:gap-4 group">
            <div className="relative scale-90 md:scale-100">
                <div className="absolute inset-0 bg-cyan-500 blur-lg opacity-20 dark:opacity-40 group-hover:opacity-60 transition-opacity"></div>
                <div className="bg-white dark:bg-gradient-to-br dark:from-slate-900 dark:to-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-white/10 relative z-10 shadow-sm dark:shadow-none">
                   <Atom className="w-6 h-6 text-cyan-600 dark:text-cyan-400 animate-[spin_10s_linear_infinite]" />
                </div>
            </div>
            <div className="flex flex-col">
                <span className="font-display font-bold text-lg md:text-2xl tracking-tight text-slate-900 dark:text-white leading-none">
                InfoGenius <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 to-indigo-600 dark:from-cyan-400 dark:to-amber-400">Vision</span>
                </span>
                <span className="text-[8px] md:text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 font-medium">Visual Knowledge Engine</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
              <button 
                onClick={handleSelectKey}
                className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-cyan-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs font-medium transition-colors border border-slate-200 dark:border-white/10"
                title="Change API Key"
              >
                <Key className="w-3.5 h-3.5" />
                <span>API Key</span>
              </button>

              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors border border-slate-200 dark:border-white/10 shadow-sm"
                title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>

              {/* Cloud Sync Auth Controls */}
              {user ? (
                <div className="flex items-center gap-2 bg-slate-100/80 dark:bg-slate-900/80 border border-slate-200 dark:border-white/10 px-2 sm:px-3 py-1.5 rounded-xl shadow-sm shrink-0">
                  {user.photoURL ? (
                    <img 
                      src={user.photoURL} 
                      alt={user.displayName || "User"} 
                      className="w-5 h-5 sm:w-6 sm:h-6 rounded-full border border-cyan-500/20 shadow-sm shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-cyan-700 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                      {user.displayName?.charAt(0) || user.email?.charAt(0) || "U"}
                    </div>
                  )}
                  <span className="hidden sm:inline text-xs font-bold text-slate-700 dark:text-slate-200 max-w-[100px] truncate">
                    {user.displayName?.split(" ")[0] || "Explorer"}
                  </span>
                  <button
                    onClick={async () => {
                      if (confirm("Are you sure you want to sign out?")) {
                        await logOutUser();
                      }
                    }}
                    className="p-1 px-1.5 bg-slate-50 dark:bg-slate-850 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600 dark:hover:text-red-400 text-slate-500 dark:text-slate-400 rounded-lg text-[10px] sm:text-xs transition-colors shrink-0 flex items-center gap-1 font-semibold border border-slate-200 dark:border-slate-300"
                    title="Sign Out"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">Sign Out</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      await signInWithGoogle();
                    } catch (error) {
                      console.error("Popup auth failed:", error);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 dark:bg-cyan-600 dark:hover:bg-cyan-500 text-white text-xs font-bold transition-transform transform active:scale-95 shadow-lg shadow-cyan-500/10 cursor-pointer shrink-0"
                  title="Sign In with Google"
                >
                  <LogIn className="w-3.5 h-3.5 animate-pulse" />
                  <span>Cloud Sync</span>
                </button>
              )}
          </div>
        </div>
      </header>

      <main className="px-3 sm:px-6 py-4 md:py-8 relative z-10">
        
        <div className={`max-w-6xl mx-auto transition-all duration-500 ${imageHistory.length > 0 ? 'mb-4 md:mb-8' : 'min-h-[50vh] md:min-h-[70vh] flex flex-col justify-center'}`}>
          
          {!imageHistory.length && (
            <div className="text-center mb-6 md:mb-16 space-y-3 md:space-y-8 animate-in slide-in-from-bottom-8 duration-700 fade-in">
              <div className="inline-flex items-center justify-center gap-2 px-4 py-1.5 rounded-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-amber-600 dark:text-amber-300 text-[10px] md:text-xs font-bold tracking-widest uppercase shadow-sm dark:shadow-[0_0_20px_rgba(251,191,36,0.1)] backdrop-blur-sm">
                <Compass className="w-3 h-3 md:w-4 md:h-4" /> Explore vast subjects like history, science, and more.
              </div>
              <h1 className="text-3xl sm:text-5xl md:text-8xl font-display font-bold text-slate-900 dark:text-white tracking-tight leading-[0.95] md:leading-[0.9]">
                Visualize <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 via-indigo-600 to-purple-600 dark:from-cyan-400 dark:via-indigo-400 dark:to-purple-400">The Unknown.</span>
              </h1>
              <p className="text-sm md:text-2xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto font-light leading-relaxed px-4">
                Generate diagrams and infographics powered by Google search grounding.
              </p>
            </div>
          )}

          {/* Cloud Sync Callout */}
          {!user && (
            <div className="max-w-xl mx-auto mb-8 p-4 bg-cyan-500/5 dark:bg-cyan-500/10 border border-cyan-500/10 dark:border-cyan-500/20 rounded-2xl flex items-center justify-between gap-4 text-slate-700 dark:text-slate-300 backdrop-blur-sm animate-in fade-in slide-in-from-top-4 shadow-sm z-20 relative animate-pulse">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-100/50 dark:bg-cyan-950/50 rounded-xl text-cyan-600 dark:text-cyan-400 shrink-0">
                  <Cloud className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">Want to save your designs?</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Sign in with Google to automatically back up your infographics to the cloud.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await signInWithGoogle();
                  } catch (err) {
                    console.error("Popup auth failed", err);
                  }
                }}
                className="px-3.5 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:brightness-110 text-white rounded-xl text-[10px] font-bold transition-transform active:scale-95 whitespace-nowrap cursor-pointer hover:shadow-md"
              >
                Connect Account
              </button>
            </div>
          )}

          {/* Search Form */}
          <form onSubmit={handleGenerate} className={`relative z-20 transition-all duration-300 ${isLoading ? 'opacity-50 pointer-events-none scale-95 blur-sm' : 'scale-100'}`}>
            
            <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-amber-500 rounded-3xl opacity-10 dark:opacity-20 group-hover:opacity-30 dark:group-hover:opacity-40 transition duration-500 blur-xl"></div>
                
                <div className="relative bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200 dark:border-white/10 p-2 rounded-3xl shadow-2xl">
                    
                    {/* Main Input */}
                    <div className="relative flex items-center">
                        <Search className="absolute left-4 md:left-6 w-5 h-5 md:w-6 md:h-6 text-slate-400 group-focus-within:text-cyan-500 transition-colors" />
                        <input
                            type="text"
                            value={topic}
                            onChange={(e) => setTopic(e.target.value)}
                            placeholder="What do you want to visualize?"
                            className="w-full pl-12 md:pl-16 pr-4 md:pr-6 py-3 md:py-6 bg-transparent border-none outline-none text-base md:text-2xl placeholder:text-slate-400 font-medium text-slate-900 dark:text-white"
                        />
                    </div>

                    {/* Controls Bar */}
                    <div className="flex flex-col md:flex-row gap-2 p-2 mt-2">
                    
                    {/* Level Selector */}
                    <div className="flex-1 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-white/5 px-4 py-3 flex items-center gap-3 hover:border-cyan-500/30 transition-colors relative overflow-hidden group/item">
                        <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-cyan-600 dark:text-cyan-400 shrink-0 shadow-sm">
                            <GraduationCap className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col z-10 w-full overflow-hidden">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Audience</label>
                            <select 
                                value={complexityLevel} 
                                onChange={(e) => setComplexityLevel(e.target.value as ComplexityLevel)}
                                className="bg-transparent border-none text-base font-bold text-slate-900 dark:text-slate-100 focus:ring-0 cursor-pointer p-0 w-full hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors truncate pr-4 [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
                            >
                                <option value="Elementary">Elementary</option>
                                <option value="High School">High School</option>
                                <option value="College">College</option>
                                <option value="Expert">Expert</option>
                            </select>
                        </div>
                    </div>

                    {/* Style Selector */}
                    <div className="flex-1 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-white/5 px-4 py-3 flex items-center gap-3 hover:border-purple-500/30 transition-colors relative overflow-hidden group/item">
                         <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-purple-600 dark:text-purple-400 shrink-0 shadow-sm">
                            <Palette className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col z-10 w-full overflow-hidden">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Aesthetic</label>
                            <select 
                                value={visualStyle} 
                                onChange={(e) => setVisualStyle(e.target.value as VisualStyle)}
                                className="bg-transparent border-none text-base font-bold text-slate-900 dark:text-slate-100 focus:ring-0 cursor-pointer p-0 w-full hover:text-purple-600 dark:hover:text-purple-300 transition-colors truncate pr-4 [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
                            >
                                <option value="Default">Standard Scientific</option>
                                <option value="Minimalist">Minimalist</option>
                                <option value="Realistic">Photorealistic</option>
                                <option value="Cartoon">Graphic Novel</option>
                                <option value="Vintage">Vintage Lithograph</option>
                                <option value="Futuristic">Cyberpunk HUD</option>
                                <option value="3D Render">3D Isometric</option>
                                <option value="Sketch">Technical Blueprint</option>
                            </select>
                        </div>
                    </div>

                     {/* Language Selector */}
                     <div className="flex-1 bg-slate-50 dark:bg-slate-950/50 rounded-2xl border border-slate-200 dark:border-white/5 px-4 py-3 flex items-center gap-3 hover:border-green-500/30 transition-colors relative overflow-hidden group/item">
                         <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-green-600 dark:text-green-400 shrink-0 shadow-sm">
                            <Globe className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col z-10 w-full overflow-hidden">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Language</label>
                            <select 
                                value={language} 
                                onChange={(e) => setLanguage(e.target.value as Language)}
                                className="bg-transparent border-none text-base font-bold text-slate-900 dark:text-slate-100 focus:ring-0 cursor-pointer p-0 w-full hover:text-green-600 dark:hover:text-green-300 transition-colors truncate pr-4 [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100"
                            >
                                <option value="English">English</option>
                                <option value="Spanish">Spanish</option>
                                <option value="French">French</option>
                                <option value="German">German</option>
                                <option value="Mandarin">Mandarin</option>
                                <option value="Japanese">Japanese</option>
                                <option value="Hindi">Hindi</option>
                                <option value="Arabic">Arabic</option>
                                <option value="Portuguese">Portuguese</option>
                                <option value="Russian">Russian</option>
                            </select>
                        </div>
                    </div>

                    {/* Generate Button */}
                    <div className="flex flex-col gap-1 w-full md:w-auto">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full md:w-auto h-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white px-8 py-4 rounded-2xl font-bold font-display tracking-wide hover:brightness-110 transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] whitespace-nowrap flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                        >
                            <Microscope className="w-5 h-5" />
                            <span>INITIATE</span>
                        </button>
                        <div className="text-center">
                            <span className="text-[9px] text-slate-400 font-medium uppercase tracking-wider opacity-70">16:9 Format</span>
                        </div>
                    </div>

                    </div>
                </div>
            </div>
          </form>
        </div>

        {isLoading && <Loading status={loadingMessage} step={loadingStep} facts={loadingFacts} />}

        {error && (
          <div className="max-w-2xl mx-auto mt-8 p-6 bg-red-100 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-2xl flex items-center gap-4 text-red-800 dark:text-red-200 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 shadow-sm">
            <AlertCircle className="w-6 h-6 flex-shrink-0 text-red-500 dark:text-red-400" />
            <div className="flex-1">
                <p className="font-medium">{error}</p>
                {(error.includes("Access denied") || error.includes("billing")) && (
                    <button 
                        onClick={handleSelectKey}
                        className="mt-2 text-xs font-bold text-red-700 dark:text-red-300 underline hover:text-red-900 dark:hover:text-red-100"
                    >
                        Select a different API key
                    </button>
                )}
            </div>
          </div>
        )}

        {imageHistory.length > 0 && !isLoading && (
            <>
                <Infographic 
                    image={imageHistory[0]} 
                    onEdit={handleEdit} 
                    isEditing={isLoading}
                    onRegenerate={handleRegenerate}
                />
                <SearchResults results={currentSearchResults} />
            </>
        )}

        {imageHistory.length > 1 && (
            <div className="max-w-7xl mx-auto mt-16 md:mt-24 border-t border-slate-200 dark:border-white/10 pt-12 transition-colors">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-8 flex items-center gap-3">
                    <History className="w-4 h-4" />
                    Session Archives
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 md:gap-6">
                    {imageHistory.slice(1).map((img) => (
                        <div 
                            key={img.id} 
                            onClick={() => restoreImage(img)}
                            className="group relative cursor-pointer rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 hover:border-cyan-500/50 transition-all shadow-lg bg-white dark:bg-slate-900/50 backdrop-blur-sm"
                        >
                            {/* Delete Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm("Are you sure you want to delete this design from cloud and session history?")) {
                                  handleDeleteInfographic(img.id);
                                }
                              }}
                              className="absolute top-2.5 right-2.5 p-2 bg-red-650 hover:bg-red-500 hover:scale-105 text-white rounded-xl transition-all z-20 opacity-0 group-hover:opacity-100 shadow-lg border border-red-500/20 cursor-pointer"
                              title="Delete design"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>

                            <img src={img.data} alt={img.prompt} className="w-full aspect-video object-cover opacity-90 dark:opacity-70 group-hover:opacity-100 transition-opacity duration-500" />
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 pt-8 translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                                <p className="text-xs text-white font-bold truncate mb-1 font-display">{img.prompt}</p>
                                <div className="flex gap-2 text-left">
                                    {img.level && <span className="text-[9px] text-cyan-100 uppercase font-bold tracking-wide px-1.5 py-0.5 rounded-full bg-cyan-900/60 border border-cyan-500/20">{img.level}</span>}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

      </main>
    </div>
    )}
    </>
  );
};

export default App;