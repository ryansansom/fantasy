import { compile } from 'pug';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { match, RouterContext } from 'react-router';
import { Provider } from 'react-redux';
import { createStore, applyMiddleware } from 'redux';
import thunkMiddleware from 'redux-thunk';
import routes from './routes';
import rootReducer from '../../redux/reducers';
import { getInitialState } from '../../redux/initial-state';
import propagateCookies from '../helpers/propogate-cookies';
import getOptions from '../helpers/options-creator';
import { modernizrScript } from '../../site/assets/scripts/modernizr';

const layoutLoc = path.join(__dirname, '../../views/layout.pug');
const masterLayout = fs.readFileSync(layoutLoc, 'utf8');
const layoutFunc = compile(masterLayout, { filename: layoutLoc });

export default (req, res, next) => {
  const templateLocals = {};

  // TODO: This is a horrible approach until I can work out the best way to resolve the manifest in dev mode...
  templateLocals.manifest = process.env.NODE_ENV === 'production'
    ? require('../../site/public/wp/manifest.json') // eslint-disable-line global-require
    : {
      '/vendor.js': 'http://localhost:8080/vendor.js',
      '/main.js': 'http://localhost:8080/main.js',
    };

  match({ routes, location: req.url }, (error, redirectLocation, renderProps) => {
    if (error) {
      res.status(500).send(error.message);
    } else if (redirectLocation) {
      res.redirect(302, redirectLocation.pathname + redirectLocation.search);
    } else if (renderProps) {
      const { components } = renderProps;
      const store = createStore(rootReducer, getInitialState(req), applyMiddleware(thunkMiddleware));

      // generate options to pass to fetchData functions
      const options = getOptions(req, renderProps);
      components[components.length - 1].fetchData(store, options)
        .then((data) => {
          // Use cookie and data from api to set new cookies
          propagateCookies(req, res, data);

          const content = (
            <Provider store={store}>
              <RouterContext {...renderProps} />
            </Provider>
          );

          // Populate pug template
          const state = store.getState();
          templateLocals.title = state.page; // Page title on server rendered page only
          templateLocals.reduxState = JSON.stringify(state);
          templateLocals.modernizrScript = modernizrScript;
          templateLocals.content = renderToString(content);

          res.status(200).send(layoutFunc(templateLocals));
        })
        .catch(next);
    } else {
      templateLocals.title = 'Page not found';
      res.status(404).send('Page not found');
    }
  });
};
