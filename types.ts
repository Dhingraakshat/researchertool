export interface Paper {
  id: string;
  title: string;
  abstract: string;
  file?: File;
  status: 'queued' | 'processing' | 'completed' | 'error';
  result?: string;
}

export interface ExtractionResult {
  studyId: string;
  paperTitle: string;
  modelingNotation: string;
  architectureLanguage: string;
  umlDiagramTypes: string;
  industryDomain: string;
  metamodelDefined: string;
  metaMetamodel: string;
  metamodelLevel: string;
  sdlcPhase: string;
  abstractionLevel: string;
  modelUsage: string;
  transformationMaturity: string;
  transformationEngine: string;
  modelingTools: string;
  generatedArtefacts: string;
}
