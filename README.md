# 🔍 Comparador de Preços NFe

Sistema completo para comparação de preços entre XML da Nota Fiscal Eletrônica (NFe) e planilhas Excel, com backend Node.js e frontend web.

## 🚀 Funcionalidades

### ✅ Parsing Avançado
- **XML NFe**: Extrai produtos da estrutura da NFe (cProd, xProd, cEAN, cEANTrib, preços)
- **Excel**: Mapeia colunas específicas (Preço, Código de barras, Descrição Produto, Código Produto)
- **Normalização EAN**: Preserva zeros à esquerda, valida comprimentos (8,12,13,14 dígitos)

### 🎯 Sistema de Matching (Prioridades)
1. **EAN Comercial** (cEAN) ↔ Código de barras Excel
2. **EAN Tributável** (cEANTrib) ↔ Código de barras Excel  
3. **Código Produto** (cProd) ↔ Código Produto Excel
4. **Fuzzy Matching** por nome (similaridade ≥ 80% + overlap de capacidades)

### 📊 Status e Análises
- **OK**: Preço tabela ≥ preço mínimo (1.5× preço XML)
- **ABAIXO_MINIMO**: Preço tabela < preço mínimo
- **SEM_PRECO**: Produto não encontrado na planilha
- **ERRO_PARSING**: Erro no cálculo do preço XML

### 🔍 Interface Completa
- Upload de arquivos XML/Excel
- Filtros por Status e Match Type
- Busca por código/descrição
- Contadores estatísticos
- Exportação CSV
- Tabela detalhada com todas as informações

## 🛠️ Instalação e Uso

### Requisitos
- Node.js 18+
- NPM

### Instalação
```bash
# Clonar/criar projeto
cd nfe-comparador

# Instalar dependências
npm install

# Executar em desenvolvimento
npm run dev
```

### Acesso Local
- **URL**: http://localhost:3000
- **API**: http://localhost:3000/api/comparar

## 📋 Estrutura de Arquivos

```
nfe-comparador/
├── server.js          # Servidor Express + API
├── package.json       # Dependências e scripts
├── vercel.json        # Configuração Vercel
├── README.md          # Este arquivo
└── public/            # Frontend
    ├── index.html     # Interface principal
    ├── style.css      # Estilos
    └── script.js      # JavaScript frontend
```

## 📈 Estrutura da Planilha Excel

A planilha deve ter **exatamente** estas colunas:

| Coluna | Descrição | Obrigatório |
|--------|-----------|-------------|
| **Preço** | Preço unitário do produto | ✅ |
| **Código de barras** | EAN/GTIN do produto | ✅ |
| **Descrição Produto** | Nome do produto (para fuzzy) | ❌ |
| **Código Produto** | Código interno (fallback) | ❌ |

### Exemplo:
```
Preço | Código de barras | Descrição Produto | Código Produto
10.50 | 7891234567890   | TRIDENT MELANCIA  | TR001
25.00 | 7891234567891   | COCA COLA 2L      | CC002
```

## 🔧 API Endpoint

### POST /api/comparar

**Formato**: `multipart/form-data`

**Campos**:
- `xml`: Arquivo XML da NFe
- `xlsx`: Arquivo Excel (.xlsx/.xls)

**Resposta**: Array JSON com objetos:
```json
{
  "codigo": "TR001",
  "descricao": "TRIDENT MELANCIA 8G CX21 168G",
  "quantidadeXml": 21.0,
  "unidade": "CX",
  "ean": "7891234567890",
  "eanTrib": "7891234567891", 
  "eanExcel": "7891234567890",
  "precoXML_unit": 0.8750,
  "precoTabela": 1.20,
  "precoMinimo": 1.3125,
  "status": "OK",
  "matchType": "EAN-Com",
  "observacoes": ""
}
```

## 🎨 Interface Web

### Contadores
- **Por Status**: OK / Abaixo Mínimo / Sem Preço / Erro Parsing
- **Por Match**: EAN-Com / EAN-Trib / Código / Fuzzy / NULL

### Cores de Status
- 🟢 **OK**: Verde
- 🔴 **Abaixo Mínimo**: Vermelho  
- ⚫ **Sem Preço**: Cinza
- 🟣 **Erro Parsing**: Roxo

### Tabela Completa
13 colunas com todas as informações detalhadas, formatação PT-BR para valores monetários.

## 📱 Deploy Vercel

1. Push para GitHub
2. Importar na Vercel
3. Deploy automático

O `vercel.json` já está configurado para:
- Backend Node.js em `/api/*`
- Frontend estático em `/`

## 🧪 Validação

Teste com item real:
- **Produto**: "TRIDENT MELANCIA 8G CX21 168G"
- **cEAN**: 7891234567890 
- **cEANTrib**: 7891234567891

Deve casar primeiro por cEAN, se não existir na planilha, tenta cEANTrib.

## 📞 Suporte

- Logs detalhados no console do servidor
- Diagnóstico automático (contagem de EANs, primeiros 10 SEM_PRECO)
- Mensagens de erro amigáveis na interface

---

**Desenvolvido com Node.js + Express + Vanilla JavaScript**