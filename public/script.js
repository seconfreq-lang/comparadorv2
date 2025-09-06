class NFEComparator {
    constructor() {
        this.data = [];
        this.filteredData = [];
        this.statusFilter = 'ALL';
        this.matchFilter = 'ALL';
        this.searchQuery = '';

        this.initializeEventListeners();
        this.updateButtonStates();
    }

    initializeEventListeners() {
        // File uploads
        document.getElementById('xmlFile').addEventListener('change', (e) => {
            this.handleFileUpload(e, 'xml');
        });

        document.getElementById('xlsxFile').addEventListener('change', (e) => {
            this.handleFileUpload(e, 'xlsx');
        });

        // Compare button
        document.getElementById('compareBtn').addEventListener('click', () => {
            this.compareFiles();
        });

        // Export button
        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportToCSV();
        });

        // Status filters
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setStatusFilter(e.target.dataset.filter);
            });
        });

        // Match type filters
        document.querySelectorAll('.filter-btn-match').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setMatchFilter(e.target.dataset.filter);
            });
        });

        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.applyFilters();
        });
    }

    handleFileUpload(event, type) {
        console.log(`File upload event for ${type}:`, event.target.files[0]);
        
        const file = event.target.files[0];
        if (!file) return;

        const fileNameElement = document.getElementById(`${type}FileName`);
        if (fileNameElement) {
            fileNameElement.textContent = file.name;
        }

        // Buscar o upload-area corretamente
        const uploadLabel = event.target.closest('.upload-label');
        const uploadArea = uploadLabel ? uploadLabel.querySelector('.upload-area') : null;
        
        if (uploadArea) {
            uploadArea.classList.add('has-file');
        } else {
            console.warn('Upload area not found for', type);
        }

        console.log(`Calling updateButtonStates after ${type} upload`);
        this.updateButtonStates();
    }

    updateButtonStates() {
        console.log("updateButtonStates called");
        const xmlFile = document.getElementById('xmlFile').files[0];
        const xlsxFile = document.getElementById('xlsxFile').files[0];
        const compareBtn = document.getElementById('compareBtn');

        console.log("XML file:", xmlFile, "XLSX file:", xlsxFile);
        console.log("Button will be disabled:", !xmlFile || !xlsxFile);
        
        if (compareBtn) {
            compareBtn.disabled = !xmlFile || !xlsxFile;
        }
    }

    async compareFiles() {
        const xmlFile = document.getElementById('xmlFile').files[0];
        const xlsxFile = document.getElementById('xlsxFile').files[0];

        if (!xmlFile || !xlsxFile) {
            this.showError('Por favor, selecione ambos os arquivos (XML e Excel)');
            return;
        }

        this.showLoading(true);
        this.hideError();

        try {
            const formData = new FormData();
            formData.append('xml', xmlFile);
            formData.append('xlsx', xlsxFile);

            const response = await fetch('/api/comparar', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Erro na comparação');
            }

            const data = await response.json();
            this.data = data;
            this.applyFilters();
            this.updateStats();
            
            document.getElementById('exportBtn').disabled = false;

            // Log diagnóstico no console
            console.log('=== DADOS RECEBIDOS ===');
            console.log(`Total de itens: ${data.length}`);
            console.log(`Com EAN: ${data.filter(d => d.ean).length}`);
            console.log(`Com EAN Trib: ${data.filter(d => d.eanTrib).length}`);

        } catch (error) {
            this.showError(`Erro: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    setStatusFilter(filter) {
        this.statusFilter = filter;
        
        // Update active button
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        
        this.applyFilters();
    }

    setMatchFilter(filter) {
        this.matchFilter = filter;
        
        // Update active button
        document.querySelectorAll('.filter-btn-match').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        
        this.applyFilters();
    }

    applyFilters() {
        let filtered = [...this.data];

        // Filter by status
        if (this.statusFilter !== 'ALL') {
            filtered = filtered.filter(item => item.status === this.statusFilter);
        }

        // Filter by match type
        if (this.matchFilter !== 'ALL') {
            filtered = filtered.filter(item => item.matchType === this.matchFilter);
        }

        // Filter by search
        if (this.searchQuery) {
            filtered = filtered.filter(item => 
                item.codigo.toLowerCase().includes(this.searchQuery) ||
                item.descricao.toLowerCase().includes(this.searchQuery) ||
                item.ean.toLowerCase().includes(this.searchQuery) ||
                item.eanTrib.toLowerCase().includes(this.searchQuery)
            );
        }

        this.filteredData = filtered;
        this.renderTable();
    }

    renderTable() {
        const tbody = document.getElementById('resultsBody');
        tbody.innerHTML = '';

        if (this.filteredData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="13" class="text-center">Nenhum resultado encontrado</td></tr>';
            return;
        }

        this.filteredData.forEach(item => {
            const row = document.createElement('tr');
            
            row.innerHTML = `
                <td class="font-mono">${item.codigo}</td>
                <td class="font-mono">${item.ean}</td>
                <td class="font-mono">${item.eanTrib}</td>
                <td class="font-mono">${item.eanExcel}</td>
                <td>${item.descricao}</td>
                <td class="text-right">${this.formatNumber(item.quantidadeXml)}</td>
                <td class="text-center">${item.unidade}</td>
                <td class="currency">${this.formatCurrency(item.precoXML_unit)}</td>
                <td class="currency">${this.formatCurrency(item.precoTabela)}</td>
                <td class="currency">${this.formatCurrency(item.precoMinimo)}</td>
                <td><span class="badge status-${item.status}">${this.formatStatus(item.status)}</span></td>
                <td class="text-center">${item.matchType}</td>
                <td>${item.observacoes}</td>
            `;

            tbody.appendChild(row);
        });
    }

    updateStats() {
        // Count by status
        const statusCounts = {
            OK: 0,
            ABAIXO_MINIMO: 0,
            SEM_PRECO: 0,
            ERRO_PARSING: 0
        };

        // Count by match type
        const matchCounts = {
            'EAN-Com': 0,
            'EAN-Trib': 0,
            'CODIGO': 0,
            'FUZZY': 0,
            'NULL': 0
        };

        this.data.forEach(item => {
            if (statusCounts.hasOwnProperty(item.status)) {
                statusCounts[item.status]++;
            }
            if (matchCounts.hasOwnProperty(item.matchType)) {
                matchCounts[item.matchType]++;
            }
        });

        // Update status counters
        Object.keys(statusCounts).forEach(status => {
            const element = document.getElementById(`count${status}`);
            if (element) {
                element.textContent = statusCounts[status].toLocaleString('pt-BR');
            }
        });

        // Update match type counters
        Object.keys(matchCounts).forEach(matchType => {
            const element = document.getElementById(`count${matchType}`);
            if (element) {
                element.textContent = matchCounts[matchType].toLocaleString('pt-BR');
            }
        });
    }

    exportToCSV() {
        if (this.filteredData.length === 0) {
            this.showError('Não há dados para exportar');
            return;
        }

        const headers = [
            'codigo',
            'descricao',
            'quantidadeXml',
            'unidade',
            'ean',
            'eanTrib',
            'eanExcel',
            'precoXML_unit',
            'precoTabela',
            'precoMinimo',
            'status',
            'matchType',
            'observacoes'
        ];

        const csvContent = [
            headers.join(','),
            ...this.filteredData.map(item => 
                headers.map(header => {
                    const value = item[header] ?? '';
                    // Escape quotes and wrap in quotes if contains comma or quotes
                    const stringValue = String(value).replace(/"/g, '""');
                    return stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')
                        ? `"${stringValue}"`
                        : stringValue;
                }).join(',')
            )
        ].join('\n');

        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `comparacao_precos_${new Date().toISOString().slice(0,10)}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }

    // Utility functions
    formatCurrency(value) {
        if (!value || value === 0) return 'R$ 0,00';
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value);
    }

    formatNumber(value) {
        if (!value || value === 0) return '0';
        return new Intl.NumberFormat('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value);
    }

    formatStatus(status) {
        const statusMap = {
            'OK': 'OK',
            'ABAIXO_MINIMO': 'Abaixo Mínimo',
            'SEM_PRECO': 'Sem Preço',
            'ERRO_PARSING': 'Erro Parsing'
        };
        return statusMap[status] || status;
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.classList.toggle('show', show);
        }
    }

    showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.classList.add('show');
            
            // Auto hide after 5 seconds
            setTimeout(() => {
                this.hideError();
            }, 5000);
        }
    }

    hideError() {
        const errorDiv = document.getElementById('errorMessage');
        if (errorDiv) {
            errorDiv.classList.remove('show');
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new NFEComparator();
});