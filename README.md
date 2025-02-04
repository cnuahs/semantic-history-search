# semantic-history-search

[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

A Chrome extension to provide semantic search over your browsing history. It goes beyond simple keyword matching of page titles, analysing the content of visited sites and allowing you to find previously visited pages based on their meaning and relevance to your queries. This provides intuitive rediscovery of previously visited sites or specific content from your history.

## Installation

### 1. Clone this repository

Clone this repository to your local machine:

```bash
git clone https://github.com/cnuahs/semantic-history-search.git
cd semantic-history-search
```

### 2. Build the Extension

Install the necessary dependencies and build the extension:

```bash
npm install
npx ng build
```

### 3. Install in Chrome as an Unpacked Extension

1.  Open Chrome and navigate to chrome://extensions/.
2.  Enable "Developer mode" by toggling the switch in the top right corner.
3.  Click on the "Load unpacked" button.
4.  Select the `dist/` directory inside your cloned repository.

The extension should now be installed and ready to use in Chrome.

## Setup and configuration

### 1. Sign Up for Pinecone

Visit the [Pinecone website](https://www.pinecone.io/) and sign up for a free account.

### 2. Create an Index

Once you have created an account and logged in, follow these steps to create an index:

1. Navigate to the "Database" / "Indexes" tab.
2. Click on the "Create Index" button.
3. Name your index (e.g., `shs-ext`).
4. Configure the index settings (number of dimensions and similarity metric) to suite your embedding model and click "Create". If using the default embedding model (c.f. [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2)), set the number of dimensions to 384 and the similarity metric to "Cosine similarity".

### 3. Get Your Pinecone API Key

To get your Pinecone API key:

1. Navigate to the "API keys" tab.
2. Click on the "Create API key" button.
3. Copy the generated API key and store it securely.

You will need this API key to configure the extension to use Pinecone for semantic search.

### 4. Configure the extension to use Pinecone

1. Click the extension's icon in the Chrome toolbar to display the UI.
2. Click the gear icon in the top right to display the "Settings" page.
3. Enter your Pinecone index name (from Step 2) and API key (from Step 3).
4. Click "Apply".

## Development

### Build

Run `npx ng build [--configuration development]` to build the extension. Build artifacts will be stored in `dist/`.

The `development` configuration builds the extension without minification. Highly recommended when debugging using the Chrome developer tools.

### Notes

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 19.1.4.

For help on the Angular CLI use `npx ng help` or see the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

---

<div align="center">
<span style="margin:0px; display:inline-block;">
  <a href="https://angular.dev/">
    <picture>
      <!-- Colour specs from https://primer.style/primitives/colors -->
      <source media="(prefers-color-scheme: dark)" srcset="https://cdn.simpleicons.org/angular/c9d1d9">
      <source media="(prefers-color-scheme: light)" srcset="https://cdn.simpleicons.org/angular/24292f">
      <img alt="Angular logo" width="50px" src="https://cdn.simpleicons.org/angular.svg">
    </picture>
  </a>
</span>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<span style="margin:0px; display:inline-block;">
  <a href="https://tailwindcss.com/">
    <picture>
      <!-- Colour specs from https://primer.style/primitives/colors -->
      <source media="(prefers-color-scheme: dark)" srcset="https://cdn.simpleicons.org/tailwindcss/c9d1d9">
      <source media="(prefers-color-scheme: light)" srcset="https://cdn.simpleicons.org/tailwindcss/24292f">
      <img alt="Tailwind CSS logo" width="50px" src="https://cdn.simpleicons.org/tailwindcss.svg">
    </picture>
  </a>
</span>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<span style="margin:0px; display:inline-block;">
  <a href="https://www.langchain.com/langchain">
    <picture>
      <!-- Colour specs from https://primer.style/primitives/colors -->
      <source media="(prefers-color-scheme: dark)" srcset="https://cdn.simpleicons.org/langchain/c9d1d9">
      <source media="(prefers-color-scheme: light)" srcset="https://cdn.simpleicons.org/langchain/24292f">
      <img alt="Electron logo" width="50px" src="https://cdn.simpleicons.org/langchain.svg">
    </picture>
  </a>
</span>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<span style="margin:0px; display:inline-block;">
  <a href="https://huggingface.co/">
    <picture>
      <!-- Colour specs from https://primer.style/primitives/colors -->
      <source media="(prefers-color-scheme: dark)" srcset="https://cdn.simpleicons.org/huggingface/c9d1d9">
      <source media="(prefers-color-scheme: light)" srcset="https://cdn.simpleicons.org/huggingface/24292f">
      <img alt="Electron logo" width="50px" src="https://cdn.simpleicons.org/huggingface.svg">
    </picture>
  </a>
</span>
</div>
