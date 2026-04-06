class Api::UsersController < ApplicationController
  before_action :authenticate_user!

  def index
    render json: User.all
  end

  def create
    user = User.new(user_params)
    if user.save
      render json: user, status: :created
    else
      render json: user.errors, status: :unprocessable_entity
    end
  end

  def show
    render json: User.find(params[:id])
  end

  def destroy
    User.find(params[:id]).destroy
    head :no_content
  end

  private

  def user_params
    params.require(:user).permit(:name, :email)
  end
end
