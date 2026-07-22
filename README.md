# 🤖 AI Browser (aibrowser)

[![Electron](https://img.shields.io/badge/Electron-31.0.0-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Gemini](https://img.shields.io/badge/Gemini-3.5%20Flash-blue?logo=google-gemini&logoColor=white)](https://deepmind.google/technologies/gemini/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**AI Browser**는 일렉트론(Electron)과 구글 제미나이(Gemini) 모델을 융합하여, 사람처럼 마우스 클릭, 키보드 입력, 스크롤 및 탭 탐색을 수행하는 **에이전트 웹 브라우저 자동화 애플리케이션**입니다. 

기존의 단순한 Selenium/Puppeteer 기반 스크립팅에서 벗어나, 사용자가 입력한 고수준의 자연어 목표(Goal)를 분석하고 실시간으로 최선의 화면 동작을 결정하여 실행합니다.

---

## ✨ 핵심 기능 (Key Features)

1. **지능형 브라우저 제어 에이전트**
   * 자연어로 된 목표(예: *"오늘 주식시황을 분석해서 내 티스토리 블로그에 포스팅해줘"*)를 입력하면 AI가 실시간으로 화면의 DOM을 분석하여 적절한 링크 클릭, 글자 입력, 화면 스크롤 등의 연속적인 동작을 자동 계획 및 실행합니다.
   
2. **크로스 오리진(Cross-Origin) 및 아이프레임(Iframe) 순회 지원**
   * 웹 보안 정책(CORS)과 동일 출처 정책(Same-Origin Policy)을 우회할 수 있도록 설계되어, 티스토리 에디터와 같이 서로 다른 도메인의 `<iframe>` 내부에 탑재된 본문 에디터 창(`contenteditable="true"`)까지 탐색하고 타이핑할 수 있습니다.

3. **Gemini 딥서치 & 실시간 검색(Search Grounding) 통합**
   * 에이전트 브레인 내부에서 제미나이의 실시간 구글 검색 API(`tools: [{ google_search: {} }]`) 및 최신 프론티어 모델인 **Gemini 3.5 Flash**를 연동하여 가동합니다.
   * 브라우저 화면상에서 구글 검색창을 거치지 않고 백그라운드에서 실시간 분석 정보를 완성한 뒤, 목표 사이트(티스토리 등)로 바로 진입하여 자동 작성을 수행합니다.

4. **다이내믹 멀티탭 관리**
   * 자동화 진행 중 링크 클릭 또는 `window.open` 등으로 새 창이 뜰 경우, 에이전트가 활성화된 탭을 실시간으로 추적하여 멀티탭 환경에서도 끊김 없이 자동화를 이어나갑니다.

5. **인스타그램 미디어 스니퍼 및 완전한 비디오 다운로드**
   * 인스타그램 등의 SNS 비디오 재생 시 조각난 range request URL들을 걸러내어, 소리(오디오)와 영상(비디오)이 온전히 결합된 고화질 **Progressive MP4** 스트림을 자동으로 추출하고 AI가 이를 스스로 인지하여 다운로드 폴더로 자동 저장합니다.

6. **강력한 봇 탐지 우회 기능 (Stealth)**
   * 크롬 브라우저 사용자 에이전트(User-Agent) 완벽 위장.
   * 봇 검출 사이트가 검사하는 `navigator.permissions.query`, `navigator.webdriver` 특성들의 흔적 완벽 마스킹.
   * 사람이 타이핑하는 속도와 키보드 입력 이벤(`keydown`, `keypress`, `input`, `keyup`)트를 정교하게 모사하여 차단 방지.

7. **최적화된 반응 속도**
   * 화면 비로딩 상황에서 불필요한 하드코딩 지연(Sleep)을 0.2초 수준으로 압축하고 루프 딜레이를 최적화하여 기존 대비 에이전트 작동 속도가 3배 향상되었습니다.

8. **자율 자가 치유(Self-Healing) 시스템 내장**
   * 브라우저 실행 중 예상치 못한 런타임 오류(스크립트 예외, 정의되지 않은 함수 호출 등)가 발생하면, 시스템이 크래시를 감지하고 **현재 활성화되어 있는 AI 프리셋**을 동적으로 호출합니다.
   * AI가 에러 코드와 콜스택을 분석한 뒤, 문제 지점의 로컬 소스코드를 부분 치환(Search-and-Replace JSON Patch) 방식으로 **자동 수정(Self-Patching)**하고 스스로 프로그램을 **자동 재기동(Relaunch)**하여 오류를 실시간으로 극복합니다.
   * 이 정밀 부분 치환 패치 설계 덕분에 토큰 오버플로우로 인한 파일 잘림 오류 없이 매우 가볍고 안전하게 작동합니다.

9. **Shadow DOM(섀도우 돔) 순회 및 자동 제어**
   * 유튜브(YouTube), 스포티파이(Spotify) 등 모던 프레임워크 웹앱의 `#shadow-root` 장막 내부 깊숙이 위치한 요소까지 재귀적으로 탐색하여 자동 클릭 및 타이핑 제어가 가능합니다.

10. **멀티 계정 / 독립 세션(Session Partitioning) 지원**
    * 설정 창에서 '독립 계정(세션 분리)' 토글을 켠 뒤 새 탭을 생성하면, 탭마다 쿠키 및 세션 데이터가 완벽하게 분리되어 하나의 브라우저 안에서 서로 다른 다수의 계정으로 동시 로그인 및 병렬 가동할 수 있습니다.

11. **범용 폼 & 콘텐츠 생성 프로토콜 (Universal Form & Content Creation Protocol)**
    * 특정 플랫폼(티스토리 등)에 종속되지 않고, 네이버 블로그, 워드프레스(WordPress), 노션(Notion), 트위터/X, 미디엄(Medium), 깃허브(GitHub), 쇼피파이(Shopify) 등 모든 웹사이트의 양식/에디터에 적용 가능한 범용 인지 프로토콜을 탑재했습니다.
    * 폼 필드 상태(`value`, `aria-expanded`, `role` 등)를 스스로 감사(Audit)하여 제목, 카테고리, 본문, 태그 등이 채워지지 않은 채 최종 제출/발행 버튼을 조기 클릭하는 행위를 근본적으로 방지합니다.

---

## 🚀 시작하기 (Getting Started)

### 요구사항
* [Node.js](https://nodejs.org/) (v18 이상 권장)
* Git
* Gemini API Key (또는 `agy` CLI 바이너리 설정)

### 설치 방법
1. 저장소를 클론합니다:
   ```bash
   git clone https://github.com/kbyms104/aibrowser.git
   cd aibrowser
   ```

2. 패키지 의존성을 설치합니다:
   ```bash
   npm install
   ```

3. 환경 변수 파일 생성 및 API 키 설정:
   * `.env.example` 파일을 복사하여 `.env` 파일을 생성합니다.
   * 복사한 `.env` 파일에 발급받으신 `GEMINI_API_KEY`를 설정합니다.

### 실행 방법
애플리케이션을 구동합니다:
```bash
npm start
```

---

## 🛠️ 설정 및 API 연동

### 1. `agy` CLI 설정 (기본 프리셋)
* 로컬 터미널에서 작동하는 에이전트 CLI(`agy`)와 동일한 흐름으로 브라우저 제어 명령을 동작시킵니다. 
* 환경 변수에 저장된 API 키를 읽어 바로 사용합니다.

### 2. 다이렉트 Cloud API 호출 (초고속 API 프리셋)
* 사이드바 우측 설정 버튼을 눌러 **Google Gemini API (Direct HTTP - Ultra Fast)**를 선택할 수 있습니다.
* 이 모드에서는 OS 프로세스 생성 오버헤드가 없어 가장 가볍고 빠르게 동작하며, **Gemini 3.5 Flash**를 기반으로 딥러닝 딥서치가 가동됩니다.

---

## 🧪 자가 치유(Self-Healing) 기능 테스트
1. 프로그램을 시작한 후 주소창 영역 우측 끝에 위치한 빨간색 **폭탄 버튼(💣)**을 클릭합니다.
2. 클릭 즉시 브라우저 렌더러에 의도적인 예외 오류(`TypeError`)가 유발됩니다.
3. 앱이 크래시 화면을 가로채고 **"자가 치유 작동 중"** 오버레이를 띄웁니다.
4. 현재 선택된 AI 프리셋(예: `agy`)이 문제 소스코드(`renderer.js`)와 에러 스택을 실시간 분석합니다.
5. 오류가 발생하는 정확한 라인만 JSON Search-and-Replace 패치 방식으로 정밀 대체하고 로컬 디스크에 자동 덮어씁니다.
6. 완료 시 자동으로 앱이 재기동(`Relaunch`)되며, 다시 폭탄 버튼을 클릭하면 AI에 의해 오류가 패치(수정)되어 정상 작동하는 것을 확인할 수 있습니다.

---

## 📄 라이선스 (License)
이 프로젝트는 MIT 라이선스에 따라 라이선스가 부여됩니다. 자세한 내용은 `LICENSE`를 참고하세요.
