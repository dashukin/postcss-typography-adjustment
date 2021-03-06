/**
 * postcss-text-indentation-adjustment plugin.
 * 
 */

/**
 * @name postCSS
 * @type {Object}
 * @property plugin
 * @property process
 * @property decl
 * @property atRule
 * @property rule
 * @property parse
 */

/**
 * @name nodeSass
 * @type {Object}
 * @property render
 * @property renderSync
 */

/**
 * @name _
 * @type {Object}
 * @property zipObjectDeep
 */

'use strict';

import postCSS from 'postcss';
import {Promise} from 'es6-promise';
import _ from 'lodash';

import {
	extractDeclarations,
	extractProperty,
	extractValue,
	extractGroups,
	hasGroup,
	exctractAtRuleReplacement,
	getCorrectionGroupArguments
} from './helpers';

/**
 * @param options {Object} Initial options
 * @param options.files {Array|String} Path or array of paths to files that should be used as correction src
 * @param [options.fontFamilyCorrection] {Object} TODO: Should be populated within
 * @param [options.dotReplacement] {String} className "dot" replacement. Required for _.zipObjectDeep
 * @param [options.corrections] {Object} Correction data for appropriate font-family
 * @param [optiosn.textMetrics.decreaseBy] {Function|Number|String} A value desired result should be decreased by.
 */
export default postCSS.plugin('postcss-text-indentation-adjustment', (options = {}) => {
	
	const {
		dotReplacement = '%dot%',
		corrections = {},
		plainCSS = true,	// if corrected values should be calculated. In case final value is NaN - all expression should be wrapped in calc()
		useCalc = false
	} = options;

	return (css, result) => {
		css.each(node => {
			const {type} = node;

			if (type === 'rule') {
				processRule(node);
			} else if (type === 'atrule') {
				processAtRule(node);
			}
		});

		function processNode (node) {
			node.each(childNode => {
				const {type} = childNode;

				if (type === 'rule') {
					processRule(childNode);
				} else if (type === 'comment') {
					processComment(childNode);
				} else if (type === 'decl') {
					processDeclaration(childNode)
				} else if (type === 'atrule') {
					processAtRule(childNode);
				}
			});
		}

		function processRule (rule) {
			rule.each(node => {
				const {type} = node;
				if (type === 'comment') {
					processComment(node);
				} else if (type === 'decl') {
					processDeclaration(node);
				} else if (type === 'rule') {
					processNode(node);
				} else if (type === 'atrule') {
					processAtRule(node);
				}
			});
		}

		function processComment (node) {
			// process comment. NOTE: higher priority is given to declaration parsing.
			// create reference to comment's rule (parent node) so we can create new declarations later
			const rule = node.parent;

			// save comment value
			const commentText = node.text;

			// remove parsed comment node
			node.remove();

			// check if comment has any correction group
			if (!hasGroup(commentText)) {
				return;
			}

			// parse comment and get an object containing declarations and their values.
			const newDeclarations = parseComment(commentText);

			// do nothing if it was a comment without correction group
			if (!newDeclarations) {
				return;
			}

			_.each(newDeclarations, (declarationValue, declarationProp) => {
				const pureCorrectedDeclarationValue = getPureCorrectedDeclarationValue(declarationValue);

				// create pure correction
				createDeclarations(rule, declarationProp, {
					value: pureCorrectedDeclarationValue
				});

				// create selector based corrections
				const selectorBasedDeclarations = getSelectorBasedCorrectedDeclarationValues(declarationValue);
				createDeclarations(rule, declarationProp, selectorBasedDeclarations);

				// create atRule based corrections
				const atRuleBasedDeclarations = getAtRuleBasedCorrectedDeclarationValues(declarationValue);
				createDeclarations(rule, declarationProp, atRuleBasedDeclarations);

				// create atRule + selector based corrections
				const atRuleSelectorBasedDeclarations = getAtRuleSelectorBasedCorrectedDeclarationValues(declarationValue);
				createDeclarations(rule, declarationProp, atRuleSelectorBasedDeclarations);
			});
		}

		function processDeclaration (node) {
			// correction template could be stored in declaration.
			// e.g. padding: $p1 - 5px - 2px /*{24px, .p2, .p1} 0 {24px, .p2, .p3}*/;

			// comment in declaration could be accessed via raw value.
			// get raw declaration value
			// e.g. $p1 - 5px - 2px /*{24px, .p2, .p1} 0 {24px, .p2, .p3}*/
			const rawValue = _.get(node, 'raws.value.raw', '');

			// in case declaration has correction group(s) - we should parse them and replace declaration value with corrected one
			if (hasGroup(rawValue)) {

				const declarationRule = node.parent;
				const declarationProperty = node.prop;

				// exctract value that is going to be processed
				// e.g. {24px, .p2, .p1} 0 {24px, .p2, .p3}
				const {value: newDeclrationValue, debug} = extractValue(rawValue);

				if (!newDeclrationValue) {
					return;
				}

				// replace all correction groups with processed values
				// e.g. 24px - 5 - 7 0 24px - 5 - 0

				// create pure correction
				const pureCorrectedDeclarationValue = getPureCorrectedDeclarationValue(newDeclrationValue, debug);
				createDeclarations(declarationRule, declarationProperty, {
					value: pureCorrectedDeclarationValue
				}, debug);

				// create selector based corrections
				const selectorBasedDeclarations = getSelectorBasedCorrectedDeclarationValues(newDeclrationValue, debug);
				createDeclarations(declarationRule, declarationProperty, selectorBasedDeclarations, debug);

				// create atRule based corrections
				const atRuleBasedDeclarations = getAtRuleBasedCorrectedDeclarationValues(newDeclrationValue, debug);
				createDeclarations(declarationRule, declarationProperty, atRuleBasedDeclarations, debug);

				// create atRule + selector based corrections
				const atRuleSelectorBasedDeclarations = getAtRuleSelectorBasedCorrectedDeclarationValues(newDeclrationValue, debug);
				createDeclarations(declarationRule, declarationProperty, atRuleSelectorBasedDeclarations, debug);
			}
		}

		function processAtRule (atRule) {
			// atrule covers any rule that starts with "@" including @media, @include, etc
			// for all cases we should ensure if there're any correction groups that should be processed.
			if (atRule.nodes) {
				// in case if atrule has child nodes (e.g. @media) we should process it like original rule
				processNode(atRule);
			} else {
				// otherwise parse atrule value
				// each rule/declaration/comment/etc has it's original value stored in "raws" property
				const atRuleRawValue = _.get(atRule, 'raws.params.raw', '');

				if (!hasGroup(atRuleRawValue)) {
					return;
				}

				// get new value from atRule params
				// e.g. {0, .p1, .l1} from @include yourMixinName(0/*{0, .p1, .l1}*/);
				const {value: newDeclrationValue = '', debug} = extractValue(atRuleRawValue);
				// create corrected value
				const pureCorrectedDeclarationValue = getPureCorrectedDeclarationValue(newDeclrationValue, debug);

				if (!pureCorrectedDeclarationValue) {
					return;
				}
				// find a string in atRule params that should be replaced with corrected value
				// e.g.  0/*{0, .p1, .l1}*/
				const atRuleReplacement = exctractAtRuleReplacement(atRuleRawValue);

				if (!atRuleReplacement) {
					_logDebug('could not extract atRule replacement from ' + atRuleRawValue);
				}
				// replace it with new value
				const newAtRuleParams = atRuleRawValue.replace(atRuleReplacement, pureCorrectedDeclarationValue);
				// set corrected value as new atRule params value
				atRule.params = newAtRuleParams;
			}
		}


		/**
		 * Parse comment text and exctract declarations and values.
		 * e.g. inline comment - // padding: {$p2, .p1, .p3}
		 * or multiline comment
		 * 	/ *
		 * 		margin-bottom: {$p3, .p2, .p3}
		 *		margin-right: {$p1, .p2, .p3}
		 * * /
		 * @param text {String}
		 * @returns {Object|Null} An object with "declaration properties" as keys and "declaration values" as values
		 */
		function parseComment (text) {
			const newDeclarations = {};
			const parsedDeclarations = extractDeclarations(text);

			parsedDeclarations.forEach(parsedDeclaration => {
				// parse declaration property name
				const declarationProp = extractProperty(parsedDeclaration);
				const {value: declarationValue, debug} = extractValue(parsedDeclaration);

				if (!declarationProp || !declarationValue) {
					return newDeclarations;
				}

				newDeclarations[declarationProp] = declarationValue;
			});

			return newDeclarations;
		}

		/**
		 * Create pure corrected declaration value parsed from input string.
		 * @param declarationValue {String} Initial declaration value that shoud be corrected.
		 * @param debug
		 * @returns {*|null} Corrected value or null
		 */
		function getPureCorrectedDeclarationValue (declarationValue, debug) {
			let correctedDeclarationValue = declarationValue;
			const correctionGroups = extractGroups(declarationValue);

			if (debug) {
				_logDebug('getPureCorrectedDeclarationValue:',);
				_logDebug('correctedDeclarationValue:', correctedDeclarationValue);
				_logDebug('correctionGroups:', correctionGroups);
			}

			correctionGroups.forEach(initialGroup => {
				const initialGroupArguments = getCorrectionGroupArguments(initialGroup);
				const firstArgument = initialGroupArguments[0];
				const correctionDataCollection = getCorrectedData.apply(null, initialGroupArguments);

				if (debug) {
					_logDebug('initialGroupArguments:', initialGroupArguments);
					_logDebug('firstArgument:', firstArgument);
					_logDebug('correctionDataCollection:', correctionDataCollection);
				}

				// Process pure corrections without any "selector" or "atRule" modifications:
				// pure corrections rely on data without correction selectors and atRules.
				// in case there're multiple definitions of any rules for the same selector we should use the last one
				const correctionValues = correctionDataCollection.map(classNameCorrectionsData => {
					return classNameCorrectionsData.filter(correctionData => {
						return !correctionData.selector && !correctionData.atRule;
					});
				}).map(filteredClassNameCorrectionsData => {
					return filteredClassNameCorrectionsData.slice(-1);
				}).reduce((prev, next) => {
					const baseDelta = _.get(next, '[0].baseDelta', 0);
					const decreaseBy = _.get(next, '[0].decreaseBy', 0);

					return prev.concat([baseDelta, decreaseBy]);
				}, [firstArgument]);

				const correctedValue = getCorrectedValue({
					correctionValues,
					useCalc
				}, debug);

				correctedDeclarationValue = correctedDeclarationValue.replace(`{${initialGroup}}`, correctedValue);

				if (debug) {
					_logDebug('correctionValues:', correctionValues);
					_logDebug('correctedValue:', correctedValue);
					_logDebug('correctedDeclarationValue:', correctedDeclarationValue);
				}

			});

			return correctionGroups.length ? correctedDeclarationValue : null;
		}


		/**
		 * Create selector based corrected declaration values
		 * @param declarationValue
		 */
		function getSelectorBasedCorrectedDeclarationValues (declarationValue) {
			let initialDeclarationValue = declarationValue;
			// first of all we should get all classNames data.
			const correctionGroups = extractGroups(declarationValue);

			const uniqueClassNames = _.uniq(correctionGroups.reduce((classNamesCollection, initialGroup) => {
				const [, ...initialGroupClassNames] = getCorrectionGroupArguments(initialGroup);

				return classNamesCollection.concat(initialGroupClassNames);
			}, [])).sort();

			const classNamesData = uniqueClassNames.reduce((outputData, className) => {
				outputData[className] = _.get(corrections, className.replace(/\./g, dotReplacement, ''), [])
					.filter(data => {
						// exclude data with atRules
						return !data.atRule;
					});

				return outputData;
			}, {});

			// find all possible selectors used for exctracted classNames
			const uniqueSelectors = _.uniq(_.reduce(classNamesData, (selectorsOutput, classNameData) => {
				const classNameDataSelectors = classNameData.reduce((classNameSelectorsOutput, correctionData) => {
					return classNameSelectorsOutput.push(correctionData.selector), classNameSelectorsOutput;
				}, []);

				return selectorsOutput.concat(classNameDataSelectors);
			}, [])).filter(selector => {
				return !!selector;
			});

			// iterate over unique selectors and create additional declarations based on selectors and classNamesData
			const selectorBasedDeclarations = uniqueSelectors.reduce((declarationsOutput, selector) => {
				let selectorBasedCorrectedDeclarationValue = initialDeclarationValue;

				correctionGroups.forEach(correctionGroup => {
					const [firstArgument, ...correctionGroupClassNames] = getCorrectionGroupArguments(correctionGroup);
					const correctionValues = correctionGroupClassNames.reduce((calculatedOutput, correctionClassName) => {
						const correctedClassNameValues = _.get(classNamesData, correctionClassName, []).filter(data => {
							return (data.selector === selector) || !data.selector;
						});
						const correctedClassNameValueData = _.find(correctedClassNameValues, {selector}) || _.find(correctedClassNameValues, {selector: ''}) || null;
						const baseDelta = _.get(correctedClassNameValueData, 'baseDelta', 0);
						const decreaseBy = _.get(correctedClassNameValueData, 'decreaseBy', 0);

						return calculatedOutput.concat([baseDelta, decreaseBy]);
					}, [firstArgument])

					const correctedValue = getCorrectedValue({
						correctionValues,
						useCalc
					});

					selectorBasedCorrectedDeclarationValue = selectorBasedCorrectedDeclarationValue.replace(`{${correctionGroup}}`, correctedValue);
				});

				const correctedSelectorBasedDeclarationData = {
					selector,
					value: selectorBasedCorrectedDeclarationValue
				}

				return declarationsOutput.push(correctedSelectorBasedDeclarationData), declarationsOutput;
			}, []);

			return selectorBasedDeclarations;
		}

		/**
		 * get atRule based corrected declaration values
		 * @param declarationValue {String}
		 * @returns {Object[]}
		 */
		function getAtRuleBasedCorrectedDeclarationValues (declarationValue, debug) {
			const initialDeclarationValue = declarationValue;

			// first of all we should get all classNames data.
			const correctionGroups = extractGroups(declarationValue);

			const uniqueClassNames = _.uniq(correctionGroups.reduce((classNamesCollection, initialGroup) => {
				const [, ...initialGroupClassNames] = getCorrectionGroupArguments(initialGroup);

				return classNamesCollection.concat(initialGroupClassNames);
			}, [])).sort();

			const classNamesData = uniqueClassNames.reduce((outputData, className) => {
				outputData[className] = _.get(corrections, className.replace(/\./g, dotReplacement, ''), [])
					.filter(data => {
						// exclude data with selectors
						return !data.selector;
					});

				return outputData;
			}, {});

			// find all possible selector used for exctracted classNames
			const atRules = _.reduce(classNamesData, (selectorsOutput, classNameData) => {
				const classNameDataSelectors = classNameData.reduce((classNameSelectorsOutput, correctionData) => {
					return classNameSelectorsOutput.push(correctionData.atRule), classNameSelectorsOutput;
				}, []);

				return selectorsOutput.concat(classNameDataSelectors);
			}, []).filter(atRule => {
				return !!atRule;
			});

			const uniqueAtRules = _.uniqWith(atRules, _.isEqual);

			// iterate over unique selectors and create additional declarations based on selectors and classNamesData
			const atRuleBasedDeclarations = uniqueAtRules.reduce((declarationsOutput, atRule) => {
				let atRuleBasedCorrectedDeclarationValue = initialDeclarationValue;

				correctionGroups.forEach(correctionGroup => {
					const [firstArgument, ...correctionGroupClassNames] = getCorrectionGroupArguments(correctionGroup);
					const correctionValues = correctionGroupClassNames.reduce((calculatedOutput, correctionClassName) => {
						const correctedClassNameValues = _.get(classNamesData, correctionClassName, []).filter(data => {
							return (_.isEqual(data.atRule, atRule)) || !data.atRule;
						});
						const correctedClassNameValueData = _.find(correctedClassNameValues, {atRule}) || _.find(correctedClassNameValues, {atRule: null, selector: ''}) || null;
						const baseDelta		= _.get(correctedClassNameValueData, 'baseDelta', 0);
						const decreaseBy	= _.get(correctedClassNameValueData, 'decreaseBy', 0);

						return calculatedOutput.concat([baseDelta, decreaseBy]);
					}, [firstArgument]);

					const correctedValue = getCorrectedValue({
						correctionValues,
						useCalc
					});

					atRuleBasedCorrectedDeclarationValue = atRuleBasedCorrectedDeclarationValue.replace(`{${correctionGroup}}`, correctedValue);
				});

				const correctedSelectorBasedDeclarationData = {
					atRule,
					value: atRuleBasedCorrectedDeclarationValue
				}

				return declarationsOutput.push(correctedSelectorBasedDeclarationData), declarationsOutput;
			}, []);

			return atRuleBasedDeclarations;
		}

		/**
		 * get atRule + selector based corrected declaration values
		 * @param declarationValue {String}
		 * @returns {Object[]}
		 */
		function getAtRuleSelectorBasedCorrectedDeclarationValues (declarationValue, debug) {
			const initialDeclarationValue = declarationValue;

			// first of all we should get all classNames data.
			const correctionGroups = extractGroups(declarationValue);

			const uniqueClassNames = _.uniq(correctionGroups.reduce((classNamesCollection, initialGroup) => {
				const [, ...initialGroupClassNames] = getCorrectionGroupArguments(initialGroup);
				return classNamesCollection.concat(initialGroupClassNames);
			}, [])).sort();

			const classNamesData = uniqueClassNames.reduce((outputData, className) => {
				outputData[className] = _.get(corrections, className.replace(/\./g, dotReplacement, ''), [])
					.filter(data => {
						// should include both atRule and selector values
						return !!data.selector && !!data.atRule;
					})
				return outputData;
			}, {});

			const atRulesSelectors = _.reduce(classNamesData, (selectorsOutput, classNameData) => {
				const classNameDataSelectors = classNameData.reduce((classNameSelectorsOutput, correctionData) => {
					return classNameSelectorsOutput.push({atRule: correctionData.atRule, selector: correctionData.selector}), classNameSelectorsOutput;
				}, []);

				return selectorsOutput.concat(classNameDataSelectors);
			}, []).filter(atRule => {
				return !!atRule;
			});

			// find all possible selector used for exctracted classNames
			const uniqueAtRulesSelectors = _.uniqWith(atRulesSelectors, _.isEqual);

			// iterate over unique selectors and create additional declarations based on selectors and classNamesData
			const atRuleBasedDeclarations = uniqueAtRulesSelectors.reduce((declarationsOutput, uniqueData) => {
				let atRuleBasedCorrectedDeclarationValue = initialDeclarationValue;

				correctionGroups.forEach(correctionGroup => {
					const [firstArgument, ...correctionGroupClassNames] = getCorrectionGroupArguments(correctionGroup);
					const correctionValues = correctionGroupClassNames.reduce((calculatedOutput, correctionClassName) => {
						const correctedClassNameValues = _.get(classNamesData, correctionClassName, []).filter(data => {
							return (_.isEqual(data.atRule, uniqueData.atRule)) && (data.selector === uniqueData.selector) || (!data.atRule && !data.selector);
						});

						const correctedClassNameValueData = _.find(correctedClassNameValues, {atRule: uniqueData.atRule, selector: uniqueData.selector}) || _.find(correctedClassNameValues, {atRule: null, selector: ''}) || null;

						const baseDelta = _.get(correctedClassNameValueData, 'baseDelta', 0);
						const decreaseBy = _.get(correctedClassNameValueData, 'decreaseBy', 0);

						return calculatedOutput.concat([baseDelta, decreaseBy]);
					}, [firstArgument]);

					const correctedValue = getCorrectedValue({
						correctionValues,
						useCalc
					});

					atRuleBasedCorrectedDeclarationValue = atRuleBasedCorrectedDeclarationValue.replace(`{${correctionGroup}}`, correctedValue);
				});

				const correctedSelectorBasedDeclarationData = {
					atRule: uniqueData.atRule,
					selector: uniqueData.selector,
					value: atRuleBasedCorrectedDeclarationValue
				}

				return declarationsOutput.push(correctedSelectorBasedDeclarationData), declarationsOutput;
			}, []);

			return atRuleBasedDeclarations;
		}


		/**
		 *
		 * @param initialValue {Number|String}
		 * @param currentClassName {String} Target element className from correction file
		 * @param siblingClassName {String} Sibling element className from correction file
		 * @returns {Array[]} Array of correction data objects for each className provided in arguments.
		 */
		function getCorrectedData (initialValue = 0, ...classNames) {
			const classNamesCorrectionsData = [];

			classNames.forEach(className => {
				/**
				 * @name correctionData
				 * @type {Array} Collection of correction rules for fiven className
				 */
				const correctionData = _.get(corrections, className.replace(/\./g, dotReplacement), null);

				if (_.isArray(correctionData)) {
					classNamesCorrectionsData.push(correctionData);
				}
			});

			return classNamesCorrectionsData;
		}

		/**
		 * Combine corrections into final result.
		 * In case calculate option is set to true - try to process given values and provide a result one.
		 * Otherwise - use calc() function
		 * @param correctionValues {Array} Corrections list
		 * @param useCalc {Boolean} If expression value should be wrapped into css calc() function
		 */
		function getCorrectedValue ({correctionValues, useCalc}, debug) {
			const [initialValueString, ...subtrahends] = correctionValues;
			const initialValue = parseInt(initialValueString.replace(/\D/g, ''), 10);
			const initialUnit = initialValueString.replace(/\d/g, '');

			const calculatedValue = subtrahends.reduce((prev, next) => {
					const subtrahend = parseInt(next, 10);
					return prev - subtrahend;
				}, initialValue);

			const expressionValue = [initialValueString].concat(subtrahends).join(' - ');

			const outputValue = plainCSS && !isNaN(calculatedValue)
				? calculatedValue + initialUnit
				: useCalc || (isNaN(calculatedValue) && useCalc)
					? `calc(${expressionValue})`
					: expressionValue;


			if (debug) {
				_logDebug('getCorrectedValue:');
				_logDebug('correctionValues:', correctionValues);
				_logDebug('initialValueString:', initialValueString);
				_logDebug('subtrahends:', subtrahends);
				_logDebug('initialValue:', initialValue);
				_logDebug('initialUnit:', initialUnit);
				_logDebug('calculatedValue:', calculatedValue);
				_logDebug('expressionValue:', expressionValue);
				_logDebug('outputValue:', outputValue);
			}

			return outputValue;
		}

		/**
		 * Update declaration value or create new one if declarationValue data contains any modification selector or atRule
		 * @param rule {Object} Postcss rule object that should be updated with new declaration(s)
		 * @param declarationProperty {String} Declaration name
		 * @param declarationValue {Object|Object[]} Declaration properties
		 * @param declarationValue.selector {String} Selector that should be applied at the beginning of newly created rule
		 * @param declarationValue.value {Number|String} Declaration value
		 */
		function createDeclarations (rule, declarationProperty, declarationValue, debug) {
			if (!rule || (!~['root', 'rule', 'atrule'].indexOf(rule.type))) {
				_logDebug(`createDeclarations: invalid type of parentNode - ${rule.type}`);
				return;
			}

			if (!_.isString(declarationProperty)) {
				_logDebug(`createDeclarations: invalid type of declarationProperty - ${declarationProperty}`);
				return;
			}

			const {selector: ruleSelector, raws: ruleRaws} = rule;
			const parentIsAtrule = rule.parent.type === 'atrule';
			const ruleIsAtRule = rule.type === 'atrule';

			// create array of declaration values even if only one object has been passed.
			declarationValue = [].concat(declarationValue);

			declarationValue.forEach(declarationData => {
				const {value = null, selector = null, atRule = null} = declarationData;

				if (!value) {
					_logDebug('createDeclarations: attempted to update declaration with invalid value:');
					_logDebug(`createDeclarations: value - ${value}, selector - ${selector}, atRule - ${atRule}`);
					return;
				}

				if (!selector && !atRule) {
					// if there's no selector and atRule in declarationData
					// we should update existing declaration values or create new directly in provided rule node
					if (rule.some(node => {return node.type === 'decl' && node.prop === declarationProperty})) {
						// update existing declaration. Pure correction
						rule.each(node => {
							if ((node.type === 'decl') && (node.prop === declarationProperty)) {
								node.value = value;
							}
						});
					} else {
						const newDeclaration = new postCSS.decl({
							prop: declarationProperty,
							value
						});
						rule.append(newDeclaration);
					}

				} else if (selector && !atRule) {
					// selector based correction
					// create new declaration
					const additionalRuleDeclaration = new postCSS.decl({
						prop: declarationProperty,
						value
					});

					// create new nested rule
					const newRule = ruleIsAtRule ? new postCSS.rule() : rule.clone();
					newRule.removeAll();

					// update rules selector
					newRule.selector = selector + ' ' + (!plainCSS ? '&' : ruleSelector);
					newRule.append(additionalRuleDeclaration);
					newRule.raws.before = '\n\t';
					newRule.raws.after = '\n';

					// insert newly created rule into node.
					if (!plainCSS) {
						rule.append(newRule);
					} else {
						if (parentIsAtrule) {
							rule.parent.append(newRule);
						} else {
							rule.root().append(newRule);
						}
					}
				} else if (!selector && atRule) {
					// atRule based correction
					const {name: atRuleName, params: atRuleParams} = atRule;
					const newAtRule = new postCSS.atRule();

					newAtRule.name = atRuleName;
					newAtRule.params = atRuleParams;

					const declaration = new postCSS.decl({
						prop: declarationProperty,
						value
					});

					const newRule = !plainCSS ? new postCSS.rule() : rule.clone();
					newRule.removeAll();

					newRule.selector = !plainCSS ? '&' : ruleSelector;

					newRule.raws.before = '\n\t';
					newRule.raws.after = '\n\t';

					// insert newly created rule into node.
					if (!plainCSS) {
						rule.append(newAtRule);
					} else {
						if (parentIsAtrule) {
							rule.parent.append(newAtRule);
						} else {
							rule.root().append(newAtRule);
						}
					}

					newAtRule.append(newRule);
					newRule.append(declaration);

				} else if (selector && atRule) {
					// atRule + selector based correction
					const {name: atRuleName, params: atRuleParams} = atRule;
					const newAtRule = new postCSS.atRule();

					newAtRule.name = atRuleName;
					newAtRule.params = atRuleParams;

					const newRule = !plainCSS ? new postCSS.rule() : rule.clone();
					newRule.removeAll();

					newRule.raws.before = '\n\t';
					newRule.raws.after = '\n\t';

					newRule.selector = selector + ' ' + (!plainCSS ? '&' : ruleSelector);

					const declaration = new postCSS.decl({
						prop: declarationProperty,
						value
					});

					// insert newly created rule into node.
					if (!plainCSS) {
						rule.append(newAtRule);
					} else {
						if (parentIsAtrule) {
							rule.parent.append(newAtRule);
						} else {
							rule.root().append(newAtRule);
						}
					}

					newAtRule.append(newRule);

					newRule.append(declaration);
				}
			});
		}

		function _logDebug (...args) {
			console.log.apply(console, ['postcss-text-indentation-adjustment: '].concat(args));
		}
	}

});
