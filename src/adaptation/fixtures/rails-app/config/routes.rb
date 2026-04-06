Rails.application.routes.draw do
  root "home#index"

  get "/login", to: "sessions#new"
  post "/login", to: "sessions#create"
  get "/dashboard", to: "dashboard#index"
  get "/oauth/callback", to: "oauth#callback"

  namespace :api do
    resources :users, only: [:index, :create, :show, :destroy]
  end
end
