/*
 * Copyright (c) 2014 Algolia
 * http://www.algolia.com/
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

(function($) {
  var self;
  
  /**
   * Algolia Search Helper providing faceting and disjunctive faceting
   * @param {AlgoliaSearch} client an AlgoliaSearch client
   * @param {string} index the index name to query
   * @param {hash} options an associative array defining the hitsPerPage, list of facets and list of disjunctive facets
   */
  window.AlgoliaSearchHelper = function(client, index, options) {
    /// Default options
    var defaults = {
      facets: [],            // list of facets to compute
      disjunctiveFacets: [], // list of disjunctive facets to compute
      hitsPerPage: 20        // number of hits per page
    };

    this.init(client, index, $.extend({}, defaults, options));
    self = this;
  };

  AlgoliaSearchHelper.prototype = {
    /**
     * Initialize a new AlgoliaSearchHelper
     * @param  {AlgoliaSearch} client an AlgoliaSearch client
     * @param  {string} index the index name to query
     * @param  {hash} options an associative array defining the hitsPerPage, list of facets and list of disjunctive facets
     * @return {AlgoliaSearchHelper}
     */
    init: function(client, index, options) {
      this.client = client;
      this.index = index;
      this.options = options;
      this.page = 0;
      this.refinements = {};
      this.disjunctiveRefinements = {};
    },

    /**
     * Perform a query
     * @param  {string} q the user query
     * @param  {function} searchCallback the result callback called with two arguments:
     *  success: boolean set to true if the request was successfull
     *  content: the query answer with an extra 'disjunctiveFacets' attribute
     */
    search: function(q, searchCallback) {
      this.q = q;
      this.searchCallback = searchCallback;
      this.page = 0;
      this.refinements = {};
      this.disjunctiveRefinements = {};
      this._search();
    },

    /**
     * Toggle refinement state of a facet
     * @param  {string} facet the facet to refine
     * @param  {string} value the associated value
     * @return {boolean} true if the facet has been found
     */
    toggleRefine: function(facet, value) {
      for (var i = 0; i < this.options.facets.length; ++i) {
        if (this.options.facets[i] == facet) {
          var refinement = facet + ':' + value;
          this.refinements[refinement] = !this.refinements[refinement];
          this.page = 0;
          this._search();
          return true;
        }
      }
      this.disjunctiveRefinements[facet] = this.disjunctiveRefinements[facet] || {};
      for (var j = 0; j < this.options.disjunctiveFacets.length; ++j) {
        if (this.options.disjunctiveFacets[j] == facet) {
          this.disjunctiveRefinements[facet][value] = !this.disjunctiveRefinements[facet][value];
          this.page = 0;
          this._search();
          return true;
        }
      }
      return false;
    },

    /**
     * Check the refinement state of a facet
     * @param  {string}  facet the facet
     * @param  {string}  value the associated value
     * @return {boolean} true if refined
     */
    isRefined: function(facet, value) {
      var refinement = facet + ':' + value;
      if (this.refinements[refinement]) {
        return true;
      }
      if (this.disjunctiveRefinements[facet] && this.disjunctiveRefinements[facet][value]) {
        return true;
      }
      return false;
    },

    /**
     * Go to next page
     */
    nextPage: function() {
      this._gotoPage(this.page + 1);
    },

    /**
     * Go to previous page
     */
    previousPage: function() {
      if (this.page > 0) {
        this._gotoPage(this.page - 1);
      }
    },

    ///////////// PRIVATE

    /**
     * Goto a page
     * @param  {integer} page The page number
     */
    _gotoPage: function(page) {
      this.page = page;
      this._search();
    },

    /**
     * Perform the underlying queries
     */
    _search: function() {
      this.client.startQueriesBatch();
      this.client.addQueryInBatch(this.index, this.q, this._getHitsSearchParams());
      for (var i = 0; i < this.options.disjunctiveFacets.length; ++i) {
        this.client.addQueryInBatch(this.index, this.q, this._getDisjunctiveFacetSearchParams(this.options.disjunctiveFacets[i]));
      }
      this.client.sendQueriesBatch(function(success, content) {
        if (!success) {
          self.searchCallback(false, content);
          return;
        }
        var aggregatedAnswer = content.results[0];
        aggregatedAnswer.disjunctiveFacets = {};
        for (var i = 1; i < content.results.length; ++i) {
          for (var facet in content.results[i].facets) {
            aggregatedAnswer.disjunctiveFacets[facet] = content.results[i].facets[facet];
            if (self.disjunctiveRefinements[facet]) {
              for (var value in self.disjunctiveRefinements[facet]) {
                if (!aggregatedAnswer.disjunctiveFacets[facet][value] && self.disjunctiveRefinements[facet][value]) {
                  aggregatedAnswer.disjunctiveFacets[facet][value] = 0;
                }
              }
            }
          }
        }
        self.searchCallback(true, aggregatedAnswer);
      });
    },

    /**
     * Build search parameters used to fetch hits
     * @return {hash}
     */
    _getHitsSearchParams: function() {
      return {
        hitsPerPage: this.options.hitsPerPage,
        page: this.page,
        facets: this.options.facets,
        facetFilters: this._getFacetFilters()
      };
    },

    /**
     * Build search parameters used to fetch a disjunctive facet
     * @param  {string} facet the associated facet name
     * @return {hash}
     */
    _getDisjunctiveFacetSearchParams: function(facet) {
      return {
        hitsPerPage: 1,
        page: 0,
        facets: facet,
        facetFilters: this._getFacetFilters(facet)
      };
    },

    /**
     * Build facetFilters parameter based on current refinements
     * @param  {string} facet if set, the current disjunctive facet
     * @return {hash}
     */
    _getFacetFilters: function(facet) {
      var facetFilters = [];
      for (var refinement in this.refinements) {
        if (this.refinements[refinement]) {
          facetFilters.push(refinement);
        }
      }
      for (var disjunctiveRefinement in this.disjunctiveRefinements) {
        if (disjunctiveRefinement != facet) {
          var refinements = [];
          for (var value in this.disjunctiveRefinements[disjunctiveRefinement]) {
            if (this.disjunctiveRefinements[disjunctiveRefinement][value]) {
              refinements.push(disjunctiveRefinement + ':' + value);
            }
          }
          if (refinements.length > 0) {
            facetFilters.push(refinements);
          }
        }
      }
      return facetFilters;
    }
  };
})(jQuery);
